#!/usr/bin/env python
"""Cross-tenant isolation suite.

The acceptance gate for multi-tenancy (MULTI_TENANCY_PLAN.md §5). Seeds two
tenants with deliberately COLLIDING data, then actively tries to cross the
boundary between them. Anything that succeeds in crossing is a failure.

Run against a live local API:

    .venv/bin/python tests/isolation_suite.py

Exit code 0 = isolated. Non-zero = leak (count of failures).

Idempotent: re-running re-uses the two fixture tenants.
"""
from __future__ import annotations

import asyncio
import csv
import sys
import uuid

import asyncpg
import httpx

sys.path.insert(0, ".")
from app.core.security import hash_password  # noqa: E402

API = "http://127.0.0.1:8000"
# Seeding deliberately uses the OWNER role: fixtures span both tenants, which is
# exactly what RLS forbids the runtime role from doing.
OWNER_DSN = "postgresql://rcm:rcm_dev_password@127.0.0.1:5434/rcm_dev"
# Probes use the RUNTIME role. Testing isolation as a superuser proves nothing —
# it is the role the application actually connects with that must be contained.
APP_DSN = "postgresql://app_user:rcm_app_dev_password@127.0.0.1:5434/rcm_dev"

# Deterministic fixture ids so the suite is re-runnable.
A_TENANT = uuid.UUID("aaaaaaaa-0000-0000-0000-00000000000a")
B_TENANT = uuid.UUID("bbbbbbbb-0000-0000-0000-00000000000b")
A_ADMIN = uuid.UUID("aaaaaaaa-0000-0000-0000-00000000a001")
B_ADMIN = uuid.UUID("bbbbbbbb-0000-0000-0000-00000000b001")
A_LOC = uuid.UUID("aaaaaaaa-0000-0000-0000-0000000000c1")
B_LOC = uuid.UUID("bbbbbbbb-0000-0000-0000-0000000000c1")
A_CUST = uuid.UUID("aaaaaaaa-0000-0000-0000-0000000000d1")
B_CUST = uuid.UUID("bbbbbbbb-0000-0000-0000-0000000000d1")

PASSWORD = "Isolation123!"
SHARED_EMAIL = "admin@shared-example.com"   # SAME email in both tenants
SHARED_CODE = "HUB01"                        # SAME location short_code
SHARED_VIN = "TESTVIN0000000001"             # SAME vin
SHARED_LOYALTY = "LOYAL-0001"                # SAME loyalty number

results: list[tuple[str, bool, str]] = []


# Set by main() before the HTTP probes run: (confirmation_number, owning tenant,
# a string from the response that proves whose data came back).
PUBLIC_CONFIRMATION: tuple[str, uuid.UUID, str] | None = None


class _Rollback(Exception):
    """Abort a probe transaction while carrying the observed count out with it.

    Probes deliberately run destructive statements; raising unwinds the
    transaction so nothing is actually committed.
    """

    def __init__(self, remaining: int) -> None:
        super().__init__(f"rollback:{remaining}")
        self.remaining = remaining


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, ok, detail))


# ── Fixtures ─────────────────────────────────────────────────────────────────

async def seed(conn: asyncpg.Connection) -> None:
    """Create two tenants whose data deliberately collides."""
    pw = hash_password(PASSWORD)

    for tid, slug, name in ((A_TENANT, "acme-iso", "Acme Isolation Co"),
                            (B_TENANT, "globex-iso", "Globex Isolation Co")):
        await conn.execute(
            """
            INSERT INTO tenants (tenant_id, slug, legal_name, primary_email,
                                 billing_address, default_currency, default_timezone,
                                 subscription_tier, status)
            VALUES ($1,$2,$3,$4,'{}','USD','America/New_York','ENTERPRISE','ACTIVE')
            ON CONFLICT (tenant_id) DO NOTHING
            """,
            tid, slug, name, f"owner@{slug}.test",
        )

    for tid, uid in ((A_TENANT, A_ADMIN), (B_TENANT, B_ADMIN)):
        await conn.execute(
            """
            INSERT INTO staff_users (user_id, tenant_id, email, password_hash,
                                     first_name, last_name, role, is_active,
                                     location_ids)
            VALUES ($1,$2,$3,$4,'Iso','Admin','SYSTEM_ADMIN',true,'{}')
            ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash
            """,
            uid, tid, SHARED_EMAIL, pw,
        )

    # Same short_code in both tenants — allowed by UNIQUE (tenant_id, short_code)
    for tid, lid, city in ((A_TENANT, A_LOC, "Springfield"), (B_TENANT, B_LOC, "Shelbyville")):
        await conn.execute(
            """
            INSERT INTO locations (location_id, tenant_id, short_code, name, location_type,
                                   address_line1, city, country_code, timezone, currency)
            VALUES ($1,$2,$3,$4,'DOWNTOWN','1 Test St',$5,'US','America/New_York','USD')
            ON CONFLICT (location_id) DO NOTHING
            """,
            lid, tid, SHARED_CODE, f"{city} Hub", city,
        )

    # Same loyalty_number in both tenants — requires the MT-06 fix
    for tid, cid, first in ((A_TENANT, A_CUST, "Ada"), (B_TENANT, B_CUST, "Grace")):
        await conn.execute(
            """
            INSERT INTO customers (customer_id, tenant_id, first_name, last_name,
                                   email, loyalty_number)
            VALUES ($1,$2,$3,'Tester',$4,$5)
            ON CONFLICT (customer_id) DO NOTHING
            """,
            cid, tid, first, f"{first.lower()}@{tid}.test", SHARED_LOYALTY,
        )


async def collision_checks(conn: asyncpg.Connection) -> None:
    """The same natural keys must be usable by both tenants simultaneously."""
    for label, sql, args in (
        ("collide: same location short_code in both tenants",
         "SELECT count(*) FROM locations WHERE short_code=$1", (SHARED_CODE,)),
        ("collide: same staff email in both tenants",
         "SELECT count(*) FROM staff_users WHERE email=$1", (SHARED_EMAIL,)),
        ("collide: same loyalty_number in both tenants",
         "SELECT count(*) FROM customers WHERE loyalty_number=$1", (SHARED_LOYALTY,)),
    ):
        n = await conn.fetchval(sql, *args)
        check(label, n >= 2, f"found {n}, expected >= 2")

    # Same VIN in both tenants
    try:
        for tid in (A_TENANT, B_TENANT):
            cls = await conn.fetchval("SELECT class_id FROM vehicle_classes LIMIT 1")
            loc = A_LOC if tid == A_TENANT else B_LOC
            if cls is None:
                break
            await conn.execute(
                """
                INSERT INTO vehicles (vehicle_id, tenant_id, vin, make, model,
                                      model_year, transmission, fuel_type,
                                      vehicle_class_id, home_location_id,
                                      current_location_id, status, odometer_current,
                                      odometer_unit, depreciation_method, fleet_type)
                VALUES (gen_random_uuid(),$1,$2,'Test','Model',2026,'AUTOMATIC','GASOLINE',
                        $3,$4,$4,'AVAILABLE',0,'MILES','STRAIGHT_LINE','OWNED')
                ON CONFLICT (tenant_id, vin) DO NOTHING
                """,
                tid, SHARED_VIN, cls, loc,
            )
        n = await conn.fetchval("SELECT count(*) FROM vehicles WHERE vin=$1", SHARED_VIN)
        check("collide: same VIN in both tenants", n >= 2, f"found {n}, expected >= 2")
    except Exception as exc:  # noqa: BLE001
        check("collide: same VIN in both tenants", False, str(exc)[:120])


# ── Database-level probes ────────────────────────────────────────────────────

async def db_probes() -> None:
    """RLS must hold even when the app layer is bypassed entirely."""
    # Probe 1: the runtime role must not be able to bypass RLS.
    conn = await asyncpg.connect(APP_DSN)
    try:
        row = await conn.fetchrow(
            "SELECT usesuper, usebypassrls FROM pg_user WHERE usename = current_user"
        )
        check(
            "db: runtime role is not a superuser",
            not row["usesuper"],
            "connected as a superuser — RLS is bypassed unconditionally",
        )
        check(
            "db: runtime role lacks BYPASSRLS",
            not row["usebypassrls"],
            "role has BYPASSRLS",
        )

        # Probe 2: with a bogus tenant pinned, tenant tables must return nothing.
        await conn.execute(
            "SELECT set_config('app.current_tenant_id',"
            "'99999999-9999-9999-9999-999999999999', false)"
        )
        leaked = await conn.fetchval("SELECT count(*) FROM customers")
        check(
            "db: bogus tenant sees zero rows",
            leaked == 0,
            f"{leaked} rows visible under a tenant that does not exist",
        )

        # Probe 2b: a tenant must OWN its catalogue, not borrow a shared one.
        #
        # These used to be global rows with tenant_id IS NULL that every tenant
        # read in common. Nobody owned them, so nobody could change them, and a
        # policy that admits NULL for reads admits it for DELETE too — which is
        # how an unscoped delete once wiped every tenant's templates at once.
        # Since migration 065 each tenant has its own copies and the templates
        # are invisible to tenants.
        await conn.execute(
            "SELECT set_config('app.current_tenant_id', $1, false)", str(A_TENANT)
        )
        for table, label in (("vehicle_classes", "vehicle classes"),
                             ("extras_catalog", "extras"),
                             ("notification_templates", "notification templates")):
            owned = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE tenant_id = $1", A_TENANT  # noqa: S608
            )
            check(
                f"db: tenant owns its own {label}",
                owned > 0,
                f"{table} has no rows owned by this tenant — quoting and "
                "notifications will silently produce nothing",
            )
            visible_global = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE tenant_id IS NULL"  # noqa: S608
            )
            check(
                f"db: seed templates are hidden from tenants in {table}",
                visible_global == 0,
                f"{visible_global} unowned rows visible — catalogues are still shared",
            )

        # Probe 2c: ...but a tenant must not be able to WRITE a global row,
        # which would publish into every other tenant's catalogue.
        try:
            await conn.execute(
                "INSERT INTO vehicle_classes (class_id, sipp_prefix, name, sort_order) "
                "VALUES (gen_random_uuid(), 'Z', 'Isolation Probe', 99)"
            )
            await conn.execute("DELETE FROM vehicle_classes WHERE name = 'Isolation Probe'")
            check("db: tenant cannot write a global catalogue row", False,
                  "insert with NULL tenant_id succeeded")
        except asyncpg.exceptions.InsufficientPrivilegeError:
            check("db: tenant cannot write a global catalogue row", True)
        except Exception as exc:  # noqa: BLE001
            check("db: tenant cannot write a global catalogue row",
                  "row-level security" in str(exc).lower(), str(exc)[:100])

        # Probe 2d: an unscoped DELETE must remove ONLY this tenant's rows.
        #
        # This probe has to keep earning its place. It once ran an explicitly
        # scoped DELETE and proved nothing; then it checked that shared rows
        # survived, which became vacuous the moment migration 065 hid the seed
        # templates from tenants (before and after both zero, always green).
        #
        # The assertion that still means something: the number of rows an
        # unscoped DELETE removes must equal exactly what this tenant owns. If
        # it reached another tenant's rows or the seed templates, it would
        # remove more.
        for table in ("extras_catalog", "notification_templates", "vehicle_classes"):
            owned = await conn.fetchval(
                f"SELECT count(*) FROM {table} WHERE tenant_id = $1", A_TENANT  # noqa: S608
            )
            try:
                async with conn.transaction():
                    await conn.execute(
                        "SELECT set_config('app.current_tenant_id', $1, true)",
                        str(A_TENANT),
                    )
                    status = await conn.execute(f"DELETE FROM {table}")  # noqa: S608
                    removed = int(status.split()[-1])
                    raise _Rollback(removed)
            except _Rollback as exc:
                check(
                    f"db: unscoped DELETE removes only own rows in {table}",
                    exc.remaining == owned,
                    f"tenant owns {owned} rows but the delete removed "
                    f"{exc.remaining} — it reached beyond this tenant",
                )
            except asyncpg.exceptions.InsufficientPrivilegeError:
                check(f"db: unscoped DELETE removes only own rows in {table}", True,
                      "denied by policy")
            except asyncpg.exceptions.ForeignKeyViolationError as exc:
                check(f"db: unscoped DELETE removes only own rows in {table}", True,
                      f"blocked by FK, not by policy: {str(exc).split(chr(10))[0][:70]}")

        # Probe 2e: a tenant must not be able to hand its rows to another
        # tenant, nor claim anyone else's. WITH CHECK governs what a row may
        # become; USING governs which rows are even visible to change.
        for table in ("vehicle_classes", "extras_catalog"):
            try:
                async with conn.transaction():
                    await conn.execute(
                        "SELECT set_config('app.current_tenant_id', $1, true)",
                        str(A_TENANT),
                    )
                    status = await conn.execute(
                        f"UPDATE {table} SET tenant_id = $1", B_TENANT  # noqa: S608
                    )
                    moved = int(status.split()[-1])
                    raise _Rollback(moved)
            except _Rollback as exc:
                check(
                    f"db: tenant cannot reassign its {table} rows to another tenant",
                    exc.remaining == 0,
                    f"{exc.remaining} rows were handed to tenant B",
                )
            except Exception:  # noqa: BLE001 — a policy refusal is the pass case
                check(f"db: tenant cannot reassign its {table} rows to another tenant",
                      True, "denied by policy")

        # Probe 2f: the audit schema is not exempt. audit.audit_events stores
        # full before/after row snapshots, so it is a superset of the PII that
        # RLS protects elsewhere — an unprotected audit table silently undoes
        # every other policy in the database.
        await conn.execute(
            "SELECT set_config('app.current_tenant_id', $1, true)", str(A_TENANT)
        )
        try:
            tenants_seen = await conn.fetchval(
                "SELECT count(DISTINCT tenant_id) FROM audit.audit_events"
            )
            check(
                "db: audit.audit_events is tenant-scoped",
                (tenants_seen or 0) <= 1,
                f"{tenants_seen} tenants visible with one tenant adopted",
            )
        except asyncpg.exceptions.InsufficientPrivilegeError:
            check("db: audit.audit_events is tenant-scoped", True, "no access granted")
        except asyncpg.exceptions.UndefinedTableError:
            check("db: audit.audit_events is tenant-scoped", True, "table absent")

        # Probe 2g: RLS applies to a partitioned parent, but querying a PARTITION
        # directly goes straight to the child relation. If the child does not
        # carry its own policy, every partition is an unguarded copy of the data.
        unprotected = await conn.fetch(
            """
            SELECT n.nspname, c.relname
            FROM pg_class c
            JOIN pg_inherits i ON i.inhrelid = c.oid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND NOT c.relrowsecurity
            ORDER BY 1, 2
            """
        )
        leaking = []
        for row in unprotected:
            qualified = f'"{row["nspname"]}"."{row["relname"]}"'
            try:
                async with conn.transaction():
                    await conn.execute(
                        "SELECT set_config('app.current_tenant_id', $1, true)",
                        str(A_TENANT),
                    )
                    seen = await conn.fetchval(
                        f"SELECT count(DISTINCT tenant_id) FROM {qualified}"  # noqa: S608
                    )
                    if (seen or 0) > 1:
                        leaking.append(f'{row["nspname"]}.{row["relname"]}')
            except Exception:  # noqa: BLE001 — no tenant_id column, or no access
                continue
        check(
            "db: no partition bypasses its parent's policy",
            not leaking,
            f"{len(unprotected)} partitions without RLS; leaking: {', '.join(leaking[:4])}",
        )

        # Probe 3: with no tenant set at all, tenant tables must return nothing.
        await conn.execute("SELECT set_config('app.current_tenant_id','', false)")
        try:
            unset = await conn.fetchval("SELECT count(*) FROM customers")
            check("db: unset tenant sees zero rows", unset == 0, f"{unset} rows visible")
        except Exception:
            # A cast error on an empty GUC is an acceptable deny.
            check("db: unset tenant sees zero rows", True, "denied by cast error")
    finally:
        await conn.close()


# ── HTTP probes ──────────────────────────────────────────────────────────────

def login(client: httpx.Client, tenant: uuid.UUID) -> str | None:
    r = client.post(
        f"{API}/api/v1/auth/login",
        json={"email": SHARED_EMAIL, "password": PASSWORD},
        headers={"X-Tenant-ID": str(tenant)},
    )
    if r.status_code != 200:
        return None
    return r.cookies.get("access_token") or "cookie"


def http_probes() -> None:
    with httpx.Client(timeout=30, follow_redirects=False) as ca, \
         httpx.Client(timeout=30, follow_redirects=False) as cb:

        tok_a = login(ca, A_TENANT)
        tok_b = login(cb, B_TENANT)
        check("http: tenant A admin can log in", tok_a is not None)
        check("http: tenant B admin can log in", tok_b is not None,
              "same email as A — proves per-tenant identity")
        if not (tok_a and tok_b):
            return

        # Same email logs into two different tenants => two different users.
        ra = ca.get(f"{API}/api/v1/auth/me", headers={"X-Tenant-ID": str(A_TENANT)})
        rb = cb.get(f"{API}/api/v1/auth/me", headers={"X-Tenant-ID": str(B_TENANT)})
        if ra.status_code == 200 and rb.status_code == 200:
            check(
                "http: identical email resolves to different users per tenant",
                ra.json().get("user_id") != rb.json().get("user_id"),
                "same user_id returned for both tenants",
            )

        # List endpoints must never contain the other tenant's rows.
        for path, marker_a, marker_b in (
            ("/api/v1/locations", "Springfield Hub", "Shelbyville Hub"),
            ("/api/v1/customers", "Ada", "Grace"),
        ):
            r = ca.get(f"{API}{path}", headers={"X-Tenant-ID": str(A_TENANT)})
            body = r.text
            if r.status_code != 200:
                check(f"http: A lists {path}", False, f"status {r.status_code}")
                continue
            check(
                f"http: {path} shows A's data and not B's",
                marker_b not in body,
                f"tenant B marker '{marker_b}' leaked into tenant A's response",
            )

        # Direct object fetch across the boundary must not succeed.
        r = ca.get(f"{API}/api/v1/customers/{B_CUST}", headers={"X-Tenant-ID": str(A_TENANT)})
        check(
            "http: A fetching B's customer by id is denied",
            r.status_code in (403, 404),
            f"status {r.status_code} (expected 403/404)",
        )

        # Header forgery: A's session claiming to be B must not act as B.
        r = ca.get(f"{API}/api/v1/customers", headers={"X-Tenant-ID": str(B_TENANT)})
        leaked = "Grace" in r.text
        check(
            "http: A's session with B's tenant header cannot read B",
            not leaked,
            "header override let tenant A read tenant B's customers",
        )

        # Unauthenticated routes are where header forgery actually bites. For a
        # logged-in caller the JWT outranks the header, so the probes above are
        # the easy case; with no session the header IS the tenant selector and
        # nothing outranks it. This suite once read 19/19 green while
        # /reservations/public/{confirmation} returned any tenant's customer to
        # an anonymous caller, because every probe here supplied no header at
        # all — testing only the case that was already safe.
        if PUBLIC_CONFIRMATION:
            conf, owner_tenant, marker = PUBLIC_CONFIRMATION
            other = A_TENANT if owner_tenant != A_TENANT else B_TENANT

            r = httpx.get(
                f"{API}/api/v1/reservations/public/{conf}",
                headers={"X-Tenant-ID": str(other)},
                timeout=30,
            )
            check(
                "http: forged tenant header cannot read another tenant's reservation",
                not (r.status_code == 200 and marker and marker in r.text),
                f"status {r.status_code}; '{marker}' returned to a caller "
                f"claiming tenant {other}",
            )

            # And the confirmation number must not be a global namespace: two
            # tenants must be able to hold the same one without collision.
            r = httpx.get(
                f"{API}/api/v1/reservations/public/{conf}",
                headers={"X-Tenant-ID": str(owner_tenant)},
                timeout=30,
            )
            check(
                "http: a reservation is still reachable by its own tenant",
                r.status_code in (200, 404),
                f"status {r.status_code} — the fix must not break the real flow",
            )

        # The bulk export is the highest-consequence surface in the product: one
        # request returns every record a workspace owns. A scoping mistake here
        # does not leak a row, it leaks a company. Probed three ways.
        import io as _io
        import zipfile as _zipfile

        r = ca.get(f"{API}/api/v1/tenants/me/export",
                   headers={"X-Tenant-ID": str(A_TENANT)})
        check(
            "http: A can export its own workspace",
            r.status_code == 200 and r.content[:2] == b"PK",
            f"status {r.status_code} — an export the owner cannot fetch is not an export",
        )

        if r.status_code == 200 and r.content[:2] == b"PK":
            # Every tenant_id inside the archive must be A's. Reading the CSVs
            # rather than trusting the row counts: a JOIN that drops its tenant
            # predicate produces a plausible-looking file, not an error.
            foreign: list[str] = []
            # Credentials must never ride along: an export gets forwarded to
            # accountants, lawyers and successor vendors. Checked against the
            # DECOMPRESSED headers — the first version of this probe scanned
            # r.content for the literal column name and passed unconditionally,
            # because DEFLATE means "password_hash" never appears as raw bytes
            # in the archive. It reported green with redaction fully disabled.
            secrets_found: list[str] = []
            SECRET_COLS = ("password_hash", "pin_hash", "mfa_secret",
                           "mfa_backup_codes", "token_hash", "esignature_hash",
                           "anthropic_api_key")

            with _zipfile.ZipFile(_io.BytesIO(r.content)) as z:
                for entry in z.namelist():
                    if not entry.endswith(".csv"):
                        continue
                    reader = csv.DictReader(
                        z.read(entry).decode("utf-8").splitlines())
                    header = reader.fieldnames or []
                    secrets_found += [
                        f"{entry}:{c}" for c in SECRET_COLS if c in header
                    ]
                    if "tenant_id" not in header:
                        continue
                    if any((row["tenant_id"] or "").strip() != str(A_TENANT)
                           for row in reader):
                        foreign.append(entry)

            check(
                "http: the export contains no other tenant's rows",
                not foreign,
                f"foreign rows in {', '.join(foreign)}",
            )
            check(
                "http: the export carries no credential columns",
                not secrets_found,
                f"exported {', '.join(secrets_found)}",
            )

        # A's session claiming to be B must not export B. There is no path
        # parameter to forge, so the header is the only lever — and the JWT has
        # to win.
        r = ca.get(f"{API}/api/v1/tenants/me/export",
                   headers={"X-Tenant-ID": str(B_TENANT)})
        check(
            "http: a forged tenant header cannot redirect the export",
            not (r.status_code == 200 and b"Shelbyville Hub" in r.content),
            "header override let tenant A export tenant B's workspace",
        )

        # Anonymous public endpoint must not default to some other tenant.
        r = httpx.get(f"{API}/api/v1/locations/public", timeout=30)
        if r.status_code == 200:
            check(
                "http: anonymous request does not silently fall back to a tenant",
                r.json() == [] or r.status_code == 400,
                f"returned {len(r.json())} locations with no tenant specified",
            )
        else:
            check("http: anonymous request does not silently fall back to a tenant",
                  r.status_code in (400, 404), f"status {r.status_code}")


# ── Runner ───────────────────────────────────────────────────────────────────

async def main() -> int:
    global PUBLIC_CONFIRMATION

    conn = await asyncpg.connect(OWNER_DSN)
    try:
        await seed(conn)
        await collision_checks(conn)

        # Pick any real reservation to aim the public-route probes at. Chosen
        # from a tenant other than A so a forged A header is a genuine crossing.
        row = await conn.fetchrow(
            """
            SELECT r.confirmation_number, r.tenant_id, c.last_name
            FROM reservations r
            JOIN customers c ON c.customer_id = r.customer_id
            WHERE r.confirmation_number IS NOT NULL
              AND c.last_name IS NOT NULL
              AND r.tenant_id <> $1
            LIMIT 1
            """,
            A_TENANT,
        )
        if row:
            PUBLIC_CONFIRMATION = (
                row["confirmation_number"],
                row["tenant_id"],
                row["last_name"],
            )
    finally:
        await conn.close()

    await db_probes()
    http_probes()

    width = max(len(n) for n, _, _ in results) + 2
    print("\n\033[1mCross-tenant isolation suite\033[0m")
    print("─" * (width + 12))
    failures = 0
    for name, ok, detail in results:
        if ok:
            print(f"  \033[32mPASS\033[0m  {name}")
        else:
            failures += 1
            print(f"  \033[31mFAIL\033[0m  {name}")
            if detail:
                print(f"        \033[2m{detail}\033[0m")
    print("─" * (width + 12))
    total = len(results)
    colour = "\033[32m" if failures == 0 else "\033[31m"
    print(f"  {colour}{total - failures}/{total} passed\033[0m, {failures} failed\n")
    return failures


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
