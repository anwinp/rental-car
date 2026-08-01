#!/usr/bin/env python
"""Fail the build when raw SQL touches a tenant table without constraining it.

RLS is the backstop, not the plan. This keeps the application layer honest so a
single misconfiguration — a role granted BYPASSRLS, a session that forgets to
bind a tenant — cannot turn into a cross-tenant read.

    .venv/bin/python tests/tenant_sql_lint.py

Exit code 0 when clean, otherwise the number of offending functions.

A function counts as constrained if it mentions tenant_id anywhere (an explicit
predicate, a filter list, or a parameter) or adopts a tenant with set_config.
That is deliberately generous: the aim is to catch the case where tenant scoping
was never considered at all.
"""
from __future__ import annotations

import ast
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent / "app" / "domains"

TENANT_TABLES = {
    "reservations", "rental_agreements", "customers", "vehicles", "locations",
    "payments", "damage_claims", "tasks", "task_comments", "staff_users",
    "rate_codes", "rate_schedule_items", "promotion_codes", "shift_logs",
    "vehicle_blocks", "vehicle_status_log", "ota_channels", "ota_leads",
    "notification_templates", "tax_templates", "extras_catalog",
    "vehicle_classes", "customer_goodwill_ledger", "reservation_versions",
}

# Functions that legitimately span tenants. Each needs a reason, and the
# platform ones bind a tenant explicitly per operation.
ALLOWLIST = {
    ("platform/router.py", "require_platform_admin"),   # reads caller's own row
    ("platform/router.py", "list_tenants"),             # adopts each tenant in turn
    ("platform/router.py", "create_tenant"),            # adopts the new tenant
    ("platform/router.py", "delete_tenant"),            # adopts the target tenant
}


def main() -> int:
    offenders: list[tuple[str, str, list[str]]] = []

    for path in sorted(ROOT.rglob("*.py")):
        src = path.read_text()
        try:
            tree = ast.parse(src)
        except SyntaxError:
            continue

        rel = str(path.relative_to(ROOT))
        for fn in [
            n for n in ast.walk(tree)
            if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))
        ]:
            if (rel, fn.name) in ALLOWLIST:
                continue
            seg = ast.get_source_segment(src, fn) or ""
            if "text(" not in seg:
                continue
            low = seg.lower()
            touched = sorted(
                t for t in TENANT_TABLES
                if re.search(rf"from\s+{t}\b|into\s+{t}\b|update\s+{t}\b", low)
            )
            if not touched:
                continue
            if "tenant_id" in low or "current_tenant_id" in low:
                continue
            offenders.append((rel, fn.name, touched[:4]))

    if not offenders:
        print("\033[32m  tenant SQL lint: clean\033[0m")
        return 0

    print(f"\033[31m  tenant SQL lint: {len(offenders)} unconstrained\033[0m\n")
    for rel, name, tables in offenders:
        print(f"    {rel} :: {name}()  touches {tables}")
    print(
        "\n  Add an explicit tenant_id predicate, or allowlist it in this file "
        "with a reason if it is genuinely cross-tenant."
    )
    return len(offenders)


if __name__ == "__main__":
    sys.exit(main())
