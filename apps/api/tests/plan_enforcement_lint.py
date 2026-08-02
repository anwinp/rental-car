#!/usr/bin/env python
"""Every plan attribute must be enforced somewhere, and every capped resource
must be checked before it is created.

Run:  .venv/bin/python tests/plan_enforcement_lint.py
Exit 0 = clean. Non-zero = the count of findings.

Written because three bypasses turned up in one audit, all found by reading
every write path by hand:

  * bulk import ignored max_vehicles entirely — a workspace capped at 25 could
    upload ten thousand, because the endpoint never called the per-vehicle
    check
  * the platform console bypassed max_staff when adding a person, so the way
    around a seat limit was to ask support
  * the console also bypassed it when reactivating someone

And before those, three attributes had sat unread for months: max_vehicles and
max_locations were displayed in the admin UI and checked nowhere, and
trial_ends_at was written by a console button that changed nothing.

Reading by hand does not scale and will not be repeated reliably. This is the
same technique as tenant_sql_lint.py — walk the AST, assert the property, keep
a small allowlist where each exemption carries a written reason.

Three checks:

  1. INSERTION — every function that inserts into a capped table reaches
     assert_within_limit, directly or through a helper.

  2. DEAD COLUMNS — every column of `plans` is read somewhere outside the
     module that administers it. A column only the admin screen touches is a
     control that does nothing, which is the exact failure this file exists to
     stop recurring.

  3. HOLLOW FEATURES — every key in the feature registry gates a real route,
     and every gated router has something behind it beyond a health check.

     Added after selling three capabilities that did not exist. The gating
     worked perfectly: corporate_accounts was gated, mounted, and its router
     held one health endpoint; telematics had no domain at all; api_access
     gated nothing. All three were on the price list, and an Enterprise
     customer would have paid for six things and received two and a half.

     The mechanism working is precisely what hid it, which is why this has to
     be a build-time check rather than a habit of remembering.
"""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "app"

# Resource -> the table whose rows it caps.
# table -> (resource name passed to assert_within_limit, singular used in
# repository method names). The singular must bind exactly: `create_vehicle`
# is a creation site, `create_vehicle_block` and `create_vehicle_class` are
# different tables and are not capped.
CAPPED_TABLES = {
    "staff_users": ("staff", "staff_user"),
    "vehicles": ("vehicles", "vehicle"),
    "locations": ("locations", "location"),
}

# Functions that insert into a capped table without checking, legitimately.
# Each needs a reason, and the reason must survive being read aloud.
INSERT_ALLOWLIST = {
    # The founding user and first branch of a brand-new workspace. A tenant at
    # zero cannot exceed any cap the schema permits: plans_caps_check forbids a
    # cap below 1.
    ("domains/tenants/public_router.py", "register"),
    ("domains/tenants/service.py", "_create_first_admin"),
    ("domains/tenants/provisioning.py", "provision_tenant_defaults"),
    ("domains/platform/router.py", "create_tenant"),
    # Reinstating a removed person reuses their existing row; the seat check
    # happens in create_staff_member before this branch is reached.
    ("domains/tenants/team_router.py", "accept_invite"),
}

# Columns of `plans` that are legitimately read only by the admin surface.
DEAD_COLUMN_ALLOWLIST = {
    # Presentation only, by design — it orders the list and nothing else.
    "sort_order",
    # Labels. Read by the UI through the API response, which this lint cannot
    # see, so exempting them here rather than weakening the check.
    "display_name",
    "description",
    "created_at",
    "updated_at",
    "code",
}

# Where a plan column being read "counts". The plans router administers them;
# reading one there proves nothing about enforcement.
ADMIN_MODULES = ("domains/platform/router.py",)

# No allowlist. A feature that gates nothing declares implemented=False in the
# registry, which makes it unsellable at the API rather than merely excused
# here — and this check then verifies that declaration is honest in both
# directions: nothing claims to be built while gating nothing, and nothing
# claims to be unbuilt while a real gate exists (which would silently withhold
# a working capability from every plan).

findings: list[str] = []


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT))


def functions(tree: ast.AST):
    return [
        n for n in ast.walk(tree)
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
    ]


def check_insertions() -> None:
    """Anything that creates a capped row must meter it first."""
    for path in sorted(ROOT.rglob("*.py")):
        try:
            src = path.read_text()
            tree = ast.parse(src)
        except (SyntaxError, UnicodeDecodeError):
            continue

        for fn in functions(tree):
            if (rel(path), fn.name) in INSERT_ALLOWLIST:
                continue
            seg = ast.get_source_segment(src, fn) or ""
            low = seg.lower()

            for table, (resource, singular) in CAPPED_TABLES.items():
                # Deliberately narrow: raw INSERT, or a call through a
                # repository. A router calling _svc.create_vehicle() is not a
                # creation site — the service it delegates to is, and that
                # service is linted here too. Flagging both would push the
                # check into two layers, which is how two layers come to
                # disagree about whether the other one did it.
                inserts = (
                    re.search(rf"insert\s+into\s+{table}\b", low)
                    or re.search(rf"\brepo(sitory)?\.create_{singular}\b", low)
                    # ORM adds go through repositories; catch the common shape.
                    or re.search(rf"session\.add\s*\(\s*{table[:-1].capitalize()}\(", seg)
                )
                if not inserts:
                    continue
                if "assert_within_limit" in seg:
                    continue
                findings.append(
                    f"{rel(path)}::{fn.name} creates {table} rows without "
                    f"assert_within_limit(..., '{resource}'). Add the check, or "
                    f"allowlist it here with a reason."
                )


def plans_columns() -> list[str]:
    """Column names of the `plans` table, from the migrations that define it.

    Read from migrations rather than the database, so the lint runs without one
    and cannot pass merely because a developer's schema is stale.

    Scoped to statements that target this table. The first version collected
    every ADD COLUMN in any migration whose text contained "plans", which swept
    up the tenants columns added by 075 — whose down_revision is literally
    "074_plans". The lint then reported three plan attributes as dead that were
    not plan attributes at all.
    """
    versions = ROOT.parent / "alembic" / "versions"
    cols: set[str] = set()

    for f in versions.glob("*.py"):
        src = f.read_text()

        # ALTER TABLE plans ... ADD COLUMN a, ADD COLUMN b — one statement,
        # several columns. Bounded by the next ALTER/CREATE/DROP or the end of
        # the SQL string, so it cannot run on into an unrelated statement.
        for block in re.finditer(
            r"ALTER\s+TABLE\s+plans\b(.*?)(?=ALTER\s+TABLE|CREATE\s|DROP\s|\"\"\"|$)",
            src, re.S | re.I,
        ):
            for m in re.finditer(
                r"ADD\s+COLUMN(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)", block.group(1), re.I
            ):
                cols.add(m.group(1))

        # The original CREATE TABLE, before 074 renamed it to `plans`.
        block = re.search(
            r"CREATE TABLE IF NOT EXISTS plan_limits\s*\((.*?)\)", src, re.S
        )
        if block:
            for line in block.group(1).splitlines():
                # Case-insensitive: the original migration writes types in
                # upper case. Matching only lower case silently dropped every
                # column defined there — including all three caps, which are
                # the ones this lint most needs to watch.
                m = re.match(
                    r"\s*(\w+)\s+(TEXT|INTEGER|BOOLEAN|TIMESTAMPTZ)\b", line, re.I
                )
                if m:
                    cols.add(m.group(1))

    cols.discard("tier")  # renamed to `code` in 074
    cols.add("code")

    if not {"max_staff", "max_vehicles", "max_locations"} <= cols:
        # A scraper that quietly finds nothing would leave this lint reporting
        # "clean" forever while checking almost nothing. Fail loudly instead.
        raise SystemExit(
            "plan_enforcement_lint: could not read the plan caps out of the "
            "migrations. The scraper is broken — fix it rather than trusting "
            f"this run. Found: {sorted(cols)}"
        )
    return sorted(cols)


def check_dead_columns() -> None:
    """A plan attribute nothing reads is a control that does nothing.

    Bound to the table, not to the word. The first version of this check simply
    searched every file for the column name, and `sort_order` passed because
    vehicle_classes happens to have one too — a check satisfiable by an
    unrelated table sharing a name is a check that passes forever. So a read
    only counts inside a function that also queries `plans`.
    """
    cols = plans_columns()
    seen: set[str] = set()

    for path in sorted(ROOT.rglob("*.py")):
        if any(path.match(f"*{m}") for m in ADMIN_MODULES):
            continue
        try:
            src = path.read_text()
            tree = ast.parse(src)
        except (SyntaxError, UnicodeDecodeError):
            continue

        # Module-level code counts too, so the whole file is the fallback scope
        # for anything outside a function.
        scopes = [ast.get_source_segment(src, fn) or "" for fn in functions(tree)]
        scopes.append(src)

        for seg in scopes:
            low = seg.lower()
            if not re.search(r"\b(from|join|update|into)\s+plans\b", low):
                continue
            for col in cols:
                if re.search(rf"\b{col}\b", seg):
                    seen.add(col)

    for col in cols:
        if col in DEAD_COLUMN_ALLOWLIST or col in seen:
            continue
        findings.append(
            f"plans.{col} is written by the admin surface and read by no query "
            f"outside it. Either enforce it, or allowlist it as presentation."
        )


def _has_real_routes(router_var: str) -> bool:
    """Whether a gated router offers anything beyond a health check."""
    import re as _re

    if not router_var:
        return False
    rf = ROOT / "domains" / router_var.replace("_router", "") / "router.py"
    if not rf.exists():
        return False
    routes = _re.findall(
        r"@router\.(?:get|post|patch|put|delete)\(\s*[\"']([^\"']+)", rf.read_text()
    )
    return any(r.strip("/") not in ("health", "") for r in routes)


def check_hollow_features() -> None:
    """A sellable capability must be gated, and the gate must guard something."""
    import re as _re

    reg = ROOT / "domains" / "tenants" / "features.py"
    if not reg.exists():
        findings.append("domains/tenants/features.py is missing; cannot check features.")
        return

    reg_src = reg.read_text()
    keys = set(_re.findall(r'Feature\(\s*"([a-z_]+)"', reg_src))
    # Everything after a key up to the next Feature( or the tuple end, so the
    # implemented=False flag is attributed to the right entry.
    declared_unbuilt = set()
    # Features enforced somewhere other than a router mount. The partner API
    # authenticates machines by API key, so require_feature — which resolves a
    # human session — cannot gate it; the check sits on key creation instead.
    # Those still have to be enforced, so the assert_feature call is verified
    # below rather than the key simply being excused.
    creation_gated = set()
    for m in _re.finditer(r'Feature\(\s*"([a-z_]+)"(.*?)(?=Feature\(|\)\n)', reg_src, _re.S):
        if "implemented=False" in m.group(2):
            declared_unbuilt.add(m.group(1))
        if 'gate="creation"' in m.group(2):
            creation_gated.add(m.group(1))

    # A creation-gated feature must appear in a real assert_feature call.
    app_src = "\n".join(
        f.read_text() for f in ROOT.rglob("*.py") if f.name != "features.py"
    )
    for key in sorted(creation_gated):
        if not _re.search(rf'assert_feature\([^)]*["\']{key}["\']', app_src, _re.S):
            findings.append(
                f"feature '{key}' declares gate=\"creation\" but no "
                f"assert_feature(..., '{key}') call exists. Nothing enforces it."
            )
    if not keys:
        findings.append("No feature keys found in the registry — the scraper is broken.")
        return

    # Every require_feature("...") anywhere, and the router it is mounted on.
    gated: dict[str, str] = {}
    main_py = (ROOT / "main.py").read_text()
    for m in _re.finditer(
        r"include_router\(\s*(\w+)[^)]*?require_feature\(\s*[\"']([a-z_]+)[\"']\s*\)",
        main_py, _re.S,
    ):
        gated[m.group(2)] = m.group(1)
    for m in _re.finditer(r'require_feature\(\s*["\']([a-z_]+)["\']\s*\)', main_py):
        gated.setdefault(m.group(1), "")

    for key in sorted(keys):
        if key not in gated and key not in declared_unbuilt and key not in creation_gated:
            findings.append(
                f"feature '{key}' gates no route but claims implemented=True. It "
                f"can be ticked on a plan and sold while granting nothing. Gate "
                f"it, or mark implemented=False in the registry."
            )
        # "Has a gate" is not "works": corporate_accounts is gated on a router
        # holding nothing but a health check. Only complain about an unbuilt
        # flag when there is something real behind the gate to withhold.
        if key in gated and key in declared_unbuilt and _has_real_routes(gated[key]):
            findings.append(
                f"feature '{key}' has a real gate with real routes behind it but "
                f"is marked implemented=False, so no plan can include it. Flip "
                f"the flag — it works."
            )

    # A gated router with only a health endpoint is an empty promise wearing a
    # lock. corporate_accounts was exactly this.
    for key, router_var in gated.items():
        if key in declared_unbuilt or not router_var:
            continue
        domain = router_var.replace("_router", "")
        rf = ROOT / "domains" / domain / "router.py"
        if not rf.exists():
            findings.append(
                f"feature '{key}' gates {router_var}, whose domain has no router.py."
            )
            continue
        routes = _re.findall(r"@router\.(?:get|post|patch|put|delete)\(\s*[\"']([^\"']+)", rf.read_text())
        real = [r for r in routes if r.strip("/") not in ("health", "")]
        if not real:
            findings.append(
                f"feature '{key}' gates {domain}, whose router has no route beyond "
                f"/health. It is sellable and hollow."
            )


def main() -> int:
    check_insertions()
    check_dead_columns()
    check_hollow_features()

    if not findings:
        print("\033[32m  plan enforcement lint: clean\033[0m")
        return 0

    print(f"\033[31m  plan enforcement lint: {len(findings)} finding(s)\033[0m")
    for f in findings:
        print(f"    - {f}")
    return len(findings)


if __name__ == "__main__":
    sys.exit(main())
