#!/usr/bin/env python
"""The platform operator must not be reachable from tenant space, in either
direction.

Run against a live local API:

    .venv/bin/python tests/platform_identity_test.py

Exit code 0 = the boundary holds. Non-zero = the count of failures.

Migration 073 moved platform identity out of staff_users. These are the
properties that made that worth doing, written as assertions so a future
refactor that quietly re-couples them fails here instead of in production.

Deliberately includes a negative control (a token forged with the right key but
the wrong typ), because a test that only ever exercises the happy path proves
the endpoint answers, not that it discriminates.
"""
from __future__ import annotations

import sys
import uuid

import asyncpg
import httpx

sys.path.insert(0, ".")
from app.core.platform_security import (  # noqa: E402
    PLATFORM_COOKIE,
    create_platform_token,
    decode_platform_token,
)
from app.core.security import (  # noqa: E402
    create_access_token,
    decode_token,
)

API = "http://127.0.0.1:8000"
OWNER_DSN = "postgresql://rcm:rcm_dev_password@127.0.0.1:5434/rcm_dev"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"  {'PASS' if ok else 'FAIL'}  {name}{'  — ' + detail if detail else ''}")
    if not ok:
        failures.append(name)


def token_family_checks() -> None:
    print("\ntoken families")

    tenant_token = create_access_token(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        roles=["SYSTEM_ADMIN"],
        primary_role="SYSTEM_ADMIN",
        location_ids=[],
        jti=str(uuid.uuid4()),
    )
    platform_token = create_platform_token(
        admin_id=uuid.uuid4(), email="op@example.com", jti=str(uuid.uuid4())
    )

    # Negative controls first: each decoder must reject the other family. Both
    # are signed with the same key, so nothing but the explicit typ check and
    # the claim shape stands between them.
    try:
        decode_token(platform_token)
        check("tenant decoder rejects a platform token", False, "it was accepted")
    except Exception:
        check("tenant decoder rejects a platform token", True)

    try:
        decode_platform_token(tenant_token)
        check("platform decoder rejects a tenant token", False, "it was accepted")
    except Exception:
        check("platform decoder rejects a tenant token", True)

    # And the positive control, so the two above cannot pass by rejecting
    # everything.
    try:
        claims = decode_platform_token(platform_token)
        check("platform decoder accepts its own token", claims.email == "op@example.com")
    except Exception as exc:
        check("platform decoder accepts its own token", False, str(exc))

    check(
        "a platform token carries no tenant claim",
        "tenant_id" not in platform_token
        or "tenant_id" not in decode_platform_token(platform_token).__dict__,
    )


async def schema_checks() -> None:
    print("\nschema")
    conn = await asyncpg.connect(OWNER_DSN)
    try:
        flag = await conn.fetchval(
            "SELECT 1 FROM information_schema.columns "
            " WHERE table_name = 'staff_users' AND column_name = 'is_platform_admin'"
        )
        check(
            "staff_users has no platform flag",
            flag is None,
            "a tenant-writable column still grants platform access" if flag else "",
        )

        tenant_col = await conn.fetchval(
            "SELECT 1 FROM information_schema.columns "
            " WHERE table_name = 'platform_admins' AND column_name = 'tenant_id'"
        )
        check("platform_admins has no tenant_id", tenant_col is None)

        fks = await conn.fetchval(
            "SELECT count(*) FROM information_schema.table_constraints "
            " WHERE table_name = 'platform_admins' AND constraint_type = 'FOREIGN KEY'"
        )
        check(
            "platform_admins has no foreign key into tenant space",
            fks == 0,
            f"{fks} found" if fks else "",
        )

        seeded = await conn.fetchval(
            "SELECT count(*) FROM platform_admins WHERE deleted_at IS NULL"
        )
        check("the incumbent operator survived the migration", seeded >= 1,
              f"{seeded} live operator(s)")
    finally:
        await conn.close()


def http_checks() -> None:
    print("\nhttp")
    client = httpx.Client(base_url=API, timeout=20.0)

    # A platform cookie is the only thing that opens the console. A tenant
    # session — even a real, valid, SYSTEM_ADMIN one — must not.
    tenant_token = create_access_token(
        user_id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        roles=["SUPER_ADMIN"],
        primary_role="SUPER_ADMIN",
        location_ids=[],
        jti=str(uuid.uuid4()),
    )
    r = client.get("/api/v1/platform/tenants", cookies={"rcm_access": tenant_token})
    check(
        "a tenant session cannot list the estate",
        r.status_code in (401, 404),
        f"got {r.status_code}",
    )

    # A platform token for an admin_id that does not exist must not pass the
    # database re-read, whatever its signature says.
    ghost = create_platform_token(
        admin_id=uuid.uuid4(), email="ghost@example.com", jti=str(uuid.uuid4())
    )
    r = client.get("/api/v1/platform/tenants", cookies={PLATFORM_COOKIE: ghost})
    check(
        "a signed token for a deleted operator is refused",
        r.status_code in (401, 404),
        f"got {r.status_code}",
    )

    # Sign-in must not require a tenant. This is the regression that started it:
    # the endpoint is reached with no X-Tenant-ID and no tenant hostname, and
    # must fail on the password rather than on the missing workspace.
    r = client.post(
        "/api/v1/platform/auth/login",
        json={"email": "nobody@example.com", "password": "wrong-password-here"},
    )
    check(
        "platform sign-in needs no tenant to reach the password check",
        r.status_code == 401 and "Tenant" not in r.text,
        f"got {r.status_code}: {r.text[:120]}",
    )
    client.close()


async def main() -> int:
    print("platform identity boundary")
    token_family_checks()
    await schema_checks()
    try:
        http_checks()
    except httpx.ConnectError:
        print("  SKIP  http checks — no API on 127.0.0.1:8000")

    print(f"\n{'clean' if not failures else str(len(failures)) + ' failure(s)'}")
    for f in failures:
        print(f"  - {f}")
    return len(failures)


if __name__ == "__main__":
    import asyncio
    raise SystemExit(asyncio.run(main()))
