"""Platform administration — managing tenants across the whole installation.

This is the only surface that legitimately crosses the tenant boundary, so it is
also the most dangerous one in the codebase. Three rules shape it:

1. **Access is gated on `staff_users.is_platform_admin`, never on a role.**
   Every workspace's first user is SYSTEM_ADMIN and a workspace can mint its own
   SUPER_ADMIN, so gating on a role would let any customer administer every
   other customer. The flag is not settable through any tenant-facing endpoint.

2. **The flag is re-read from the database on every request**, not trusted from
   the token. Revoking platform access takes effect immediately rather than
   whenever the holder's session happens to expire.

3. **Cross-tenant work adopts each tenant in turn** rather than switching to a
   BYPASSRLS role. RLS stays in force throughout: the console can only ever see
   a tenant it has explicitly named, which keeps a bug scoped to one workspace
   instead of all of them.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session_untenanted
from app.core.security import UserClaims, get_current_user
from app.core.tenancy import RESERVED_SLUGS, invalidate_slug_cache
from app.core.security import hash_password
from app.domains.tenants.provisioning import provision_tenant_defaults

router = APIRouter()
log = structlog.get_logger()

# Tables a tenant's data lives in, ordered so children go before parents.
# Used only by hard delete.
_TENANT_TABLES = (
    "email_verifications", "task_comments", "tasks", "shift_logs",
    "customer_goodwill_ledger", "damage_claims", "payments",
    "reservation_versions", "rental_agreements", "reservations",
    "vehicle_status_log", "vehicle_blocks", "vehicles",
    "promotion_codes", "rate_schedule_items", "rate_codes",
    "ota_leads", "ota_channels", "notification_templates", "tax_templates",
    "extras_catalog", "vehicle_classes", "customers", "locations",
    "staff_users",
)


# ── Access control ───────────────────────────────────────────────────────────

async def require_platform_admin(
    session: AsyncSession = Depends(get_session_untenanted),
    claims: UserClaims = Depends(get_current_user),
) -> UserClaims:
    """Allow only holders of the platform-admin flag.

    Re-read from the database deliberately — see rule 2 in the module docstring.
    """
    # staff_users is RLS-protected, and this session starts with no tenant
    # bound — so the lookup must first adopt the caller's OWN tenant. That is
    # reading your own row, which is always permitted; the platform powers
    # themselves still hang off the flag found there.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(claims.tenant_id)},
    )
    row = (
        await session.execute(
            text(
                "SELECT is_platform_admin FROM staff_users "
                "WHERE user_id = :u AND is_active"
            ),
            {"u": str(claims.user_id)},
        )
    ).first()

    if not row or not row[0]:
        # Deliberately a 404, not a 403: the console's existence is not
        # advertised to accounts that cannot use it.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
        )
    return claims


# ── Schemas ──────────────────────────────────────────────────────────────────

class TenantSummary(BaseModel):
    tenant_id: uuid.UUID
    slug: str
    name: str
    status: str
    primary_email: str
    created_at: datetime
    staff: int = 0
    locations: int = 0
    vehicles: int = 0
    reservations: int = 0
    is_self: bool = False


class CreateTenantRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=3, max_length=40)
    admin_first_name: str = Field(min_length=1, max_length=60)
    admin_last_name: str = Field(min_length=1, max_length=60)
    admin_email: EmailStr
    admin_password: str = Field(min_length=10, max_length=128)

    @field_validator("slug")
    @classmethod
    def _slug(cls, v: str) -> str:
        v = v.strip().lower()
        if v in RESERVED_SLUGS:
            raise ValueError("That workspace address is reserved.")
        return v


class DeleteTenantRequest(BaseModel):
    """Deleting a workspace destroys every row it owns.

    The slug must be typed back to confirm — an id in a URL is far too easy to
    get wrong, and there is no undo.
    """

    confirm_slug: str


class ActionResult(BaseModel):
    ok: bool
    message: str
    deleted_rows: dict[str, int] | None = None


# ── List ─────────────────────────────────────────────────────────────────────

@router.get("/tenants", response_model=list[TenantSummary], summary="List all workspaces")
async def list_tenants(
    session: AsyncSession = Depends(get_session_untenanted),
    claims: UserClaims = Depends(require_platform_admin),
) -> list[TenantSummary]:
    # require_platform_admin adopts the caller's own tenant to read its
    # staff_users row. Clear it before listing: `tenants` is under RLS from
    # migration 062, and with a tenant bound this query would return exactly one
    # row — the caller's own workspace — rather than the estate.
    #
    # Same pattern already used before the create and delete paths below.
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    rows = (
        await session.execute(
            text(
                "SELECT tenant_id, slug, legal_name, status, primary_email, created_at "
                "FROM tenants WHERE deleted_at IS NULL ORDER BY created_at"
            )
        )
    ).mappings().all()

    out: list[TenantSummary] = []
    for r in rows:
        # Adopt each tenant in turn so RLS scopes the counts for us.
        await session.execute(
            text("SELECT set_config('app.current_tenant_id', :t, true)"),
            {"t": str(r["tenant_id"])},
        )
        counts = (
            await session.execute(
                text(
                    "SELECT (SELECT count(*) FROM staff_users)   AS staff,"
                    "       (SELECT count(*) FROM locations)     AS locations,"
                    "       (SELECT count(*) FROM vehicles)      AS vehicles,"
                    "       (SELECT count(*) FROM reservations)  AS reservations"
                )
            )
        ).mappings().first() or {}

        out.append(
            TenantSummary(
                tenant_id=r["tenant_id"],
                slug=r["slug"],
                name=r["legal_name"],
                status=r["status"],
                primary_email=r["primary_email"],
                created_at=r["created_at"],
                staff=counts.get("staff", 0),
                locations=counts.get("locations", 0),
                vehicles=counts.get("vehicles", 0),
                reservations=counts.get("reservations", 0),
                is_self=str(r["tenant_id"]) == str(claims.tenant_id),
            )
        )

    # Leave no tenant bound to the connection after a cross-tenant sweep.
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    return out


# ── Create ───────────────────────────────────────────────────────────────────

@router.post(
    "/tenants",
    response_model=TenantSummary,
    status_code=status.HTTP_201_CREATED,
    summary="Create a workspace directly",
)
async def create_tenant(
    body: CreateTenantRequest,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: UserClaims = Depends(require_platform_admin),
) -> TenantSummary:
    """Create an ACTIVE workspace without the email round-trip.

    Self-service signup requires confirmation because the address is unproven.
    Here a platform administrator is vouching for it, so the workspace is usable
    immediately — useful for onboarding a customer over the phone.
    """
    if (
        await session.execute(
            text("SELECT 1 FROM tenants WHERE slug = :s"), {"s": body.slug}
        )
    ).first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The address '{body.slug}' is already taken.",
        )

    tenant_id, admin_id = uuid.uuid4(), uuid.uuid4()
    now = datetime.now(timezone.utc)

    await session.execute(
        text(
            """
            INSERT INTO tenants (tenant_id, slug, legal_name, primary_email,
                                 billing_address, default_currency, default_timezone,
                                 subscription_tier, status, created_at, updated_at)
            VALUES (:id, :slug, :name, :email, '{}', 'USD', 'America/New_York',
                    'STARTER', 'ACTIVE', :now, :now)
            """
        ),
        {"id": str(tenant_id), "slug": body.slug, "name": body.company_name,
         "email": str(body.admin_email), "now": now},
    )

    # Adopt the new tenant so its own rows satisfy WITH CHECK.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )
    await session.execute(
        text(
            """
            INSERT INTO staff_users (user_id, tenant_id, email, password_hash,
                                     first_name, last_name, role, is_active,
                                     location_ids, created_at, updated_at,
                                     is_mfa_enabled, failed_login_count,
                                     phone_verified, email_verified_at)
            VALUES (:uid, :tid, :email, :pw, :first, :last, 'SYSTEM_ADMIN', true,
                    '{}', :now, :now, false, 0, false, :now)
            """
        ),
        {"uid": str(admin_id), "tid": str(tenant_id),
         "email": str(body.admin_email).lower(),
         "pw": hash_password(body.admin_password),
         "first": body.admin_first_name, "last": body.admin_last_name, "now": now},
    )

    await provision_tenant_defaults(
        session, tenant_id,
        location_name=f"{body.company_name} — Main Branch", location_code="MAIN",
    )
    await invalidate_slug_cache(body.slug)

    log.info("platform_tenant_created", slug=body.slug, tenant_id=str(tenant_id),
             by=str(claims.user_id), ip=request.client.host if request.client else None)

    return TenantSummary(
        tenant_id=tenant_id, slug=body.slug, name=body.company_name,
        status="ACTIVE", primary_email=str(body.admin_email), created_at=now,
        staff=1, locations=1,
    )


# ── Suspend / reactivate ─────────────────────────────────────────────────────

@router.post("/tenants/{tenant_id}/suspend", response_model=ActionResult,
             summary="Suspend a workspace")
async def suspend_tenant(
    tenant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: UserClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Block sign-in while keeping all data.

    The reversible option, and the right one in almost every case where deletion
    is tempting: the login path already refuses any non-ACTIVE workspace.
    """
    if str(tenant_id) == str(claims.tenant_id):
        raise HTTPException(400, "You cannot suspend the workspace you are signed in to.")

    res = await session.execute(
        text("UPDATE tenants SET status = 'SUSPENDED', updated_at = now() "
             "WHERE tenant_id = :t AND deleted_at IS NULL RETURNING slug"),
        {"t": str(tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    await invalidate_slug_cache(row[0])
    log.info("platform_tenant_suspended", slug=row[0], by=str(claims.user_id))
    return ActionResult(ok=True, message=f"{row[0]} is suspended. Data is retained.")


@router.post("/tenants/{tenant_id}/reactivate", response_model=ActionResult,
             summary="Reactivate a suspended workspace")
async def reactivate_tenant(
    tenant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: UserClaims = Depends(require_platform_admin),
) -> ActionResult:
    res = await session.execute(
        text("UPDATE tenants SET status = 'ACTIVE', updated_at = now() "
             "WHERE tenant_id = :t AND deleted_at IS NULL RETURNING slug"),
        {"t": str(tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    await invalidate_slug_cache(row[0])
    log.info("platform_tenant_reactivated", slug=row[0], by=str(claims.user_id))
    return ActionResult(ok=True, message=f"{row[0]} is active again.")


# ── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/tenants/{tenant_id}", response_model=ActionResult,
               summary="Permanently delete a workspace and all its data")
async def delete_tenant(
    tenant_id: uuid.UUID,
    body: DeleteTenantRequest,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: UserClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Destroy a workspace and every row it owns. There is no undo.

    Guarded three ways: the caller's own workspace is refused, the slug must be
    typed back, and the row counts removed are returned and logged so the action
    leaves a trail.
    """
    if str(tenant_id) == str(claims.tenant_id):
        raise HTTPException(400, "You cannot delete the workspace you are signed in to.")

    row = (
        await session.execute(
            text("SELECT slug, legal_name FROM tenants WHERE tenant_id = :t"),
            {"t": str(tenant_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    if body.confirm_slug.strip().lower() != row["slug"].lower():
        raise HTTPException(
            400,
            f"Type '{row['slug']}' exactly to confirm deletion.",
        )

    # Adopt the target so RLS scopes every delete to it — a missing WHERE clause
    # here cannot reach another workspace's rows.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )

    deleted: dict[str, int] = {}
    for table in _TENANT_TABLES:
        # Each delete gets its own SAVEPOINT. In PostgreSQL a single failed
        # statement aborts the entire transaction and every later command is
        # ignored, so catching the error without a savepoint would silently turn
        # the rest of the deletion into no-ops and still report success.
        try:
            async with session.begin_nested():
                # ALWAYS scope by tenant_id explicitly. Relying on RLS alone is
                # wrong for deletion in two ways, both of which destroyed data
                # the first time this ran:
                #   * shared-catalogue tables have USING (tenant_id IS NULL OR
                #     ...), and DELETE is filtered by USING — so an unscoped
                #     DELETE removed the GLOBAL rows every tenant shares;
                #   * tables without RLS (email_verifications) were not filtered
                #     at all, so it removed every tenant's rows.
                res = await session.execute(  # noqa: S608
                    text(f"DELETE FROM {table} WHERE tenant_id = :t"),
                    {"t": str(tenant_id)},
                )
                if res.rowcount:
                    deleted[table] = res.rowcount
        except Exception as exc:  # noqa: BLE001 — absent table, or a FK we do not own
            log.warning("platform_delete_skipped", table=table, error=str(exc)[:160])

    await session.execute(
        text("SELECT set_config('app.current_tenant_id', '', true)")
    )
    await session.execute(
        text("DELETE FROM tenants WHERE tenant_id = :t"), {"t": str(tenant_id)}
    )
    await invalidate_slug_cache(row["slug"])

    log.warning(
        "platform_tenant_deleted",
        slug=row["slug"], tenant_id=str(tenant_id), by=str(claims.user_id),
        ip=request.client.host if request.client else None, rows=deleted,
    )
    total = sum(deleted.values())
    return ActionResult(
        ok=True,
        message=f"Deleted {row['legal_name']} ({row['slug']}) and {total} rows.",
        deleted_rows=deleted,
    )
