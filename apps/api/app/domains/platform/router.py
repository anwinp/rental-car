"""Platform administration — managing tenants across the whole installation.

This is the only surface that legitimately crosses the tenant boundary, so it is
also the most dangerous one in the codebase. Three rules shape it:

1. **Access is gated on membership of `platform_admins`, never on a role and
   never on a column of a tenant table.** Every workspace's first user is
   SYSTEM_ADMIN and a workspace can mint its own SUPER_ADMIN, so gating on a
   role would let any customer administer every other customer. Platform
   identity lives in its own table with no tenant_id and no foreign key into
   tenant space, so it is not reachable — or grantable — from tenant data at
   all. It replaced a boolean on staff_users, which meant the operator had to
   be an employee of one of its own customers.

2. **Membership is re-read from the database on every request**, not trusted
   from the token. Revoking platform access takes effect immediately rather
   than whenever the holder's session happens to expire.

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
from app.core.platform_security import PlatformClaims, get_current_platform_admin
from app.core.config import settings
from app.core.tenancy import (
    RESERVED_SLUGS,
    invalidate_slug_cache,
    tenant_host,
)
from app.core.security import hash_password
from app.domains.tenants.provisioning import provision_tenant_defaults

router = APIRouter()
log = structlog.get_logger()

# Every table a tenant's data lives in, ordered so children go before parents.
# Used only by purge.
#
# This list was hand-maintained and had drifted badly: it missed the entire
# archive schema — retired copies of customers, payments, reservations,
# agreements and damage claims, carrying exactly the same personal data as the
# live tables — plus the audit log, the notification log, telematics and
# webhook records. None of those has an FK to tenants, so DELETE FROM tenants
# succeeded and left them orphaned against a UUID that no longer resolves.
#
# The effect was worse than incomplete. A customer deleting their workspace to
# discharge a GDPR erasure request was told "deleted N rows" while their
# renters' names, licence numbers and payment records stayed behind. The report
# was not merely partial, it was affirmatively wrong.
#
# Derived once by querying information_schema for every table carrying a
# tenant_id, so it can be re-derived rather than remembered:
#
#   SELECT table_schema||'.'||table_name FROM information_schema.columns
#    WHERE column_name = 'tenant_id';
#
# Partition children (…_default and the pg_partman monthly partitions) are
# deliberately absent: deleting through the parent covers them.
_TENANT_TABLES = (
    # Archive first — it references nothing and nothing references it, but it
    # holds PII and is the part that was silently surviving deletion.
    "archive.object_registry",
    "archive.damage_claims", "archive.payments",
    "archive.rental_agreements", "archive.reservations", "archive.customers",
    # Logs and ledgers.
    "audit.audit_events", "notification_log", "telematics_events",
    "processed_webhooks",
    # Live data, children before parents.
    "email_verifications", "staff_invitations", "task_comments", "tasks",
    "shift_logs", "customer_goodwill_ledger", "damage_claims", "payments",
    "reservation_versions", "rental_agreements", "reservations",
    "vehicle_status_log", "vehicle_blocks", "vehicles",
    "promotion_codes", "rate_schedule_items", "rate_codes",
    "ota_leads", "ota_channels", "notification_templates",
    "extras_catalog", "vehicle_classes", "customers",
    # locations before tax_templates: locations.tax_template_id references it
    # (migration 067 linked every branch to a template), so deleting templates
    # first is a foreign-key violation. The original ordering had it the wrong
    # way round and nobody noticed, because the failure was swallowed and the
    # purge still reported success.
    "locations", "tax_templates",
    "staff_users",
)

# How long a soft-deleted workspace is recoverable before it may be purged.
_PURGE_GRACE_DAYS = 30


# ── Access control ───────────────────────────────────────────────────────────

async def require_platform_admin(
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(get_current_platform_admin),
) -> PlatformClaims:
    """Allow only a live platform operator.

    Re-read from the database deliberately — see rule 2 in the module docstring.
    A token proves who signed in; only the row proves they may still act.

    No tenant is bound and none is adopted. platform_admins is not tenant data
    and carries no RLS, which is why this lookup needs no GUC at all — the
    previous version had to adopt the caller's own tenant to read their
    staff_users row, and that was the shape of the bug, not an implementation
    detail.
    """
    row = (
        await session.execute(
            text(
                "SELECT token_epoch FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).first()

    if not row:
        # Deliberately a 404, not a 403: the console's existence is not
        # advertised to callers that cannot use it.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Not found."
        )

    # A token minted before a password change is dead regardless of its jti.
    if claims.epoch < int(row[0]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated."
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
    # Deleted workspaces are listed rather than hidden, so the console can
    # actually reach restore and purge. Null for a live one.
    deleted_at: datetime | None = None
    restore_days_left: int | None = None
    subscription_tier: str | None = None
    trial_ends_at: datetime | None = None


class TenantDetail(BaseModel):
    """Everything the console shows for one workspace.

    Configuration is exposed as counts and booleans only. A support view must
    never become a way to read a customer's API keys or secrets.
    """
    tenant_id: uuid.UUID
    slug: str
    name: str
    trading_name: str | None = None
    status: str
    primary_email: str | None = None
    primary_phone: str | None = None
    created_at: datetime
    deleted_at: datetime | None = None
    restore_days_left: int | None = None

    subscription_tier: str | None = None
    trial_ends_at: datetime | None = None
    subscription_ends_at: datetime | None = None
    currency: str | None = None
    timezone: str | None = None
    tos_accepted_at: datetime | None = None
    tos_version: str | None = None

    # The three addresses, built the same way registration builds them, so
    # "our booking link doesn't work" can be answered by clicking it.
    booking_url: str
    admin_url: str
    counter_url: str

    staff_count: int = 0
    locations: int = 0
    vehicles: int = 0
    reservations: int = 0
    reservations_30d: int = 0
    last_reservation_at: datetime | None = None

    # Readiness signals — these answer "why can't they take a booking".
    active_rate_codes: int = 0
    priced_extras: int = 0
    locations_with_tax: int = 0

    staff: list[dict] = []
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
    claims: PlatformClaims = Depends(require_platform_admin),
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
                # Deleted workspaces are INCLUDED. Filtering them out made the
                # restore and purge endpoints unreachable from the product:
                # the only way to find a workspace is this list, and a customer
                # who deletes by mistake on Monday could not be helped on
                # Tuesday. They are returned with their grace clock so the
                # console can offer restore while it is still possible.
                "SELECT tenant_id, slug, legal_name, status, primary_email, "
                "       created_at, deleted_at, subscription_tier, trial_ends_at, "
                "       GREATEST(0, :grace - EXTRACT(day FROM now() - deleted_at)::int) "
                "         AS restore_days_left "
                "  FROM tenants ORDER BY deleted_at NULLS FIRST, created_at"
            ),
            {"grace": _PURGE_GRACE_DAYS},
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
                is_self=False,
                deleted_at=r["deleted_at"],
                restore_days_left=(
                    r["restore_days_left"] if r["deleted_at"] else None
                ),
                subscription_tier=r["subscription_tier"],
                trial_ends_at=r["trial_ends_at"],
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
    claims: PlatformClaims = Depends(require_platform_admin),
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
             by=str(claims.admin_id), ip=request.client.host if request.client else None)

    return TenantSummary(
        tenant_id=tenant_id, slug=body.slug, name=body.company_name,
        status="ACTIVE", primary_email=str(body.admin_email), created_at=now,
        staff=1, locations=1,
    )


# ── Suspend / reactivate ─────────────────────────────────────────────────────

async def _revoke_tenant_sessions(session: AsyncSession, tenant_id: str) -> int:
    """End every live session belonging to a workspace. Returns the user count.

    Raising each user's credential epoch is the durable half — it invalidates
    tokens this process cannot enumerate, including refresh tokens — and the
    JTI sweep makes it immediate rather than waiting out the epoch cache.
    """
    from app.core.redis import REVOKED_TOKENS_SET, get_session_redis
    from app.core.security import bump_epoch
    from app.domains.auth.service import USER_SESSIONS_KEY

    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": tenant_id},
    )
    users = [
        str(r[0])
        for r in (
            await session.execute(
                text(
                    "SELECT user_id FROM staff_users "
                    " WHERE tenant_id = :t AND deleted_at IS NULL"
                ),
                {"t": tenant_id},
            )
        ).all()
    ]

    for uid in users:
        await bump_epoch(session, uid)

    try:
        redis = get_session_redis()
        for uid in users:
            jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=uid))
            if jtis:
                await redis.sadd(REVOKED_TOKENS_SET, *jtis)
            await redis.delete(USER_SESSIONS_KEY.format(user_id=uid))
    except Exception:  # noqa: BLE001 — the epoch is already written and holds
        log.warning("tenant_session_sweep_failed", tenant_id=tenant_id, exc_info=True)

    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    return len(users)


@router.post("/tenants/{tenant_id}/suspend", response_model=ActionResult,
             summary="Suspend a workspace")
async def suspend_tenant(
    tenant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Block sign-in while keeping all data.

    The reversible option, and the right one in almost every case where deletion
    is tempting: the login path already refuses any non-ACTIVE workspace.
    """
    # Clear the tenant binding first. The caller has no tenant of their own
    # any more, so nothing should be stamped onto this transaction — but the
    # ContextVar hook stamps whatever it finds, and an empty GUC is the only
    # state in which `tenants` yields more than one row. This clear is what the
    # estate-wide UPDATE below depends on, not a leftover. list_tenants clears
    # it for exactly this
    # reason; these two never did.
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    res = await session.execute(
        text("UPDATE tenants SET status = 'SUSPENDED', updated_at = now() "
             "WHERE tenant_id = :t AND deleted_at IS NULL RETURNING slug"),
        {"t": str(tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    await invalidate_slug_cache(row[0])

    # Sign everyone out now. Login already refuses a suspended workspace, but
    # nothing touched sessions that already existed — so suspension took up to
    # one access-token lifetime to bite, and on the counter PWA that is EIGHT
    # HOURS. A workspace suspended at the start of a shift kept checking cars
    # out for the rest of it.
    signed_out = await _revoke_tenant_sessions(session, str(tenant_id))

    log.info(
        "platform_tenant_suspended",
        slug=row[0], by=str(claims.admin_id), sessions_ended=signed_out,
    )
    return ActionResult(
        ok=True,
        message=f"{row[0]} is suspended and {signed_out} staff signed out. "
                "Data is retained.",
    )


@router.post("/tenants/{tenant_id}/reactivate", response_model=ActionResult,
             summary="Reactivate a suspended workspace")
async def reactivate_tenant(
    tenant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    # Clear the tenant binding first. The caller has no tenant of their own
    # any more, so nothing should be stamped onto this transaction — but the
    # ContextVar hook stamps whatever it finds, and an empty GUC is the only
    # state in which `tenants` yields more than one row. This clear is what the
    # estate-wide UPDATE below depends on, not a leftover. list_tenants clears
    # it for exactly this
    # reason; these two never did.
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    res = await session.execute(
        text("UPDATE tenants SET status = 'ACTIVE', updated_at = now() "
             "WHERE tenant_id = :t AND deleted_at IS NULL RETURNING slug"),
        {"t": str(tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    await invalidate_slug_cache(row[0])
    log.info("platform_tenant_reactivated", slug=row[0], by=str(claims.admin_id))
    return ActionResult(ok=True, message=f"{row[0]} is active again.")


# ── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/tenants/{tenant_id}", response_model=ActionResult,
               summary="Delete a workspace (recoverable for 30 days)")
async def delete_tenant(
    tenant_id: uuid.UUID,
    body: DeleteTenantRequest,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Take a workspace out of service, recoverably.

    This used to destroy everything immediately with no undo. One correct HTTP
    call — the slug typed back, which protects against a mis-click but not
    against a script — and a business's entire operating record was gone.

    Now it marks the workspace deleted and signs everyone out. It stops
    resolving at once: tenant_id_for_slug filters deleted_at, so the storefront,
    back office and counter all go dark immediately and the data is still there.
    Purging is a separate, explicit act (POST .../purge) and is refused until
    the grace period has elapsed.

    tenants.deleted_at has existed since the original schema and was filtered
    in eight places while being written by nothing at all — soft delete was
    scaffolding nobody had connected.
    """
    # Bind nothing. `tenants` is under RLS and its policy admits every row
    # only while app.current_tenant_id is empty; any value here would narrow
    # this to a single workspace and silently miss the target.
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    row = (
        await session.execute(
            text(
                "SELECT slug, legal_name, deleted_at FROM tenants "
                " WHERE tenant_id = :t"
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(404, "No such workspace.")
    if row["deleted_at"] is not None:
        raise HTTPException(409, f"'{row['slug']}' is already deleted.")

    if body.confirm_slug.strip().lower() != row["slug"].lower():
        raise HTTPException(400, f"Type '{row['slug']}' exactly to confirm deletion.")

    await session.execute(
        text(
            "UPDATE tenants SET deleted_at = now(), status = 'CANCELLED', "
            "       updated_at = now() "
            " WHERE tenant_id = :t"
        ),
        {"t": str(tenant_id)},
    )
    signed_out = await _revoke_tenant_sessions(session, str(tenant_id))
    await invalidate_slug_cache(row["slug"])

    log.warning(
        "platform_tenant_soft_deleted",
        slug=row["slug"], tenant_id=str(tenant_id), by=str(claims.admin_id),
        ip=request.client.host if request.client else None,
        sessions_ended=signed_out,
    )
    return ActionResult(
        ok=True,
        message=(
            f"{row['legal_name']} ({row['slug']}) is deleted and {signed_out} "
            f"staff signed out. Data is retained and recoverable for "
            f"{_PURGE_GRACE_DAYS} days."
        ),
    )


@router.post("/tenants/{tenant_id}/restore", response_model=ActionResult,
             summary="Undo a deletion within the grace period")
async def restore_tenant(
    tenant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Bring back a soft-deleted workspace.

    Restored SUSPENDED rather than ACTIVE: whatever prompted the deletion is
    unlikely to have resolved itself, and an operator finding their storefront
    live again without anyone deciding so is the wrong surprise. Reactivate is
    a separate, deliberate step.
    """
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    res = await session.execute(
        text(
            "UPDATE tenants SET deleted_at = NULL, status = 'SUSPENDED', "
            "       updated_at = now() "
            " WHERE tenant_id = :t AND deleted_at IS NOT NULL RETURNING slug"
        ),
        {"t": str(tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No deleted workspace with that id.")

    await invalidate_slug_cache(row[0])
    log.warning("platform_tenant_restored", slug=row[0], by=str(claims.admin_id))
    return ActionResult(
        ok=True,
        message=f"{row[0]} is restored, and suspended. Reactivate it to resume trading.",
    )


@router.post("/tenants/{tenant_id}/purge", response_model=ActionResult,
             summary="Permanently destroy a deleted workspace's data")
async def purge_tenant(
    tenant_id: uuid.UUID,
    body: DeleteTenantRequest,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Destroy every row a deleted workspace owns. There is no undo.

    Separated from delete so that destruction is never a side effect of
    removing a customer from service. Refused unless the workspace is already
    soft-deleted and the grace period has elapsed, so the irreversible step
    cannot be reached in a single call.

    Unlike the old delete, a table that fails is reported as a failure. That
    version caught every exception per table, logged a warning nobody reads,
    and still returned ok=True with the table simply absent from the counts —
    indistinguishable from "it had no rows".
    """
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    row = (
        await session.execute(
            text(
                "SELECT slug, legal_name, deleted_at, "
                "       (now() - deleted_at) >= make_interval(days => :g) AS ripe "
                "  FROM tenants WHERE tenant_id = :t"
            ),
            {"t": str(tenant_id), "g": _PURGE_GRACE_DAYS},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(404, "No such workspace.")
    if row["deleted_at"] is None:
        raise HTTPException(
            409,
            "Delete this workspace first. Purge only destroys data that is "
            "already out of service.",
        )
    if not row["ripe"]:
        raise HTTPException(
            409,
            f"'{row['slug']}' was deleted less than {_PURGE_GRACE_DAYS} days ago. "
            "It stays recoverable until then.",
        )
    if body.confirm_slug.strip().lower() != row["slug"].lower():
        raise HTTPException(400, f"Type '{row['slug']}' exactly to confirm.")

    # Adopt the target so RLS scopes every delete to it — a missing WHERE
    # clause here cannot reach another workspace's rows.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )

    deleted: dict[str, int] = {}
    failed: dict[str, str] = {}
    for table in _TENANT_TABLES:
        # Each delete gets its own SAVEPOINT. In PostgreSQL a single failed
        # statement aborts the whole transaction and every later command is
        # ignored, so catching without a savepoint would turn the rest of the
        # purge into no-ops and still report success.
        try:
            async with session.begin_nested():
                # ALWAYS scope by tenant_id explicitly. Relying on RLS alone is
                # wrong for deletion in two ways, both of which destroyed data
                # the first time this ran: shared-catalogue policies admit
                # tenant_id IS NULL and DELETE is filtered by USING, so an
                # unscoped DELETE removed the GLOBAL rows every tenant shares;
                # and tables without RLS were not filtered at all.
                res = await session.execute(  # noqa: S608 — names are a literal tuple
                    text(f"DELETE FROM {table} WHERE tenant_id = :t"),
                    {"t": str(tenant_id)},
                )
                if res.rowcount:
                    deleted[table] = res.rowcount
        except Exception as exc:  # noqa: BLE001
            failed[table] = str(exc)[:200]
            log.error("platform_purge_table_failed", table=table, error=str(exc)[:200])

    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    if failed:
        # Do not remove the tenant row: it is the only handle left on whatever
        # survived, and reporting success over a partial purge is how personal
        # data goes missing from a deletion report while remaining in the
        # database.
        raise HTTPException(
            status_code=500,
            detail=(
                f"Purge incomplete — {len(failed)} table(s) failed and the "
                f"workspace was NOT removed: {', '.join(sorted(failed))}. "
                "Nothing has been reported as deleted that was not."
            ),
        )

    await session.execute(
        text("DELETE FROM tenants WHERE tenant_id = :t"), {"t": str(tenant_id)}
    )
    await invalidate_slug_cache(row["slug"])

    log.warning(
        "platform_tenant_purged",
        slug=row["slug"], tenant_id=str(tenant_id), by=str(claims.admin_id),
        ip=request.client.host if request.client else None, rows=deleted,
    )
    total = sum(deleted.values())
    return ActionResult(
        ok=True,
        message=f"Purged {row['legal_name']} ({row['slug']}) and {total} rows.",
        deleted_rows=deleted,
    )


class PlanChange(BaseModel):
    """Commercial terms. Only the platform may set these."""
    subscription_tier: str | None = None
    trial_ends_at: datetime | None = None
    subscription_ends_at: datetime | None = None


@router.patch("/tenants/{tenant_id}/plan", response_model=ActionResult,
              summary="Change a workspace's plan or trial")
async def change_tenant_plan(
    tenant_id: uuid.UUID,
    body: PlanChange,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Move a workspace between plans, or extend its trial.

    Nothing in the product could do this. Creation hardcodes STARTER, and the
    tenant's own update schema deliberately excludes subscription_tier with a
    comment saying plan changes belong to the platform console — which had no
    such endpoint. So a customer who upgraded and paid stayed capped on Starter
    permanently, and there was no way to extend a trial for someone who asked.

    Deliberately here and not on the tenant router: PATCH /tenants/{id} is
    gated on admin:config, which a workspace's own administrator holds, and RLS
    lets a bound tenant update its own row. Exposing the field there let any
    operator lift their own caps by sending one request.
    """
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    tier = (body.subscription_tier or "").strip().upper() or None
    if tier:
        allowed = [
            r[0]
            for r in (
                await session.execute(text("SELECT tier FROM plan_limits ORDER BY tier"))
            ).all()
        ]
        # Checked against plan_limits rather than a constant, because a tier
        # with no limits row silently reads as "unlimited" downstream — which
        # is how PROFESSIONAL came to grant Enterprise capacity for Starter
        # money. If it cannot be metered, it cannot be sold.
        if tier not in allowed:
            raise HTTPException(
                400,
                f"Unknown plan '{tier}'. Configured plans: {', '.join(allowed)}.",
            )

    sets, params = [], {"t": str(tenant_id)}
    if tier:
        sets.append("subscription_tier = :tier")
        params["tier"] = tier
    if body.trial_ends_at is not None:
        sets.append("trial_ends_at = :trial")
        params["trial"] = body.trial_ends_at
    if body.subscription_ends_at is not None:
        sets.append("subscription_ends_at = :subend")
        params["subend"] = body.subscription_ends_at
    if not sets:
        raise HTTPException(400, "Nothing to change.")

    res = await session.execute(
        text(
            f"UPDATE tenants SET {', '.join(sets)}, updated_at = now() "  # noqa: S608
            " WHERE tenant_id = :t AND deleted_at IS NULL "
            " RETURNING slug, subscription_tier"
        ),
        params,
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    log.warning(
        "platform_plan_changed",
        slug=row[0], tenant_id=str(tenant_id), by=str(claims.admin_id),
        tier=row[1], trial_ends_at=str(body.trial_ends_at or ""),
    )
    return ActionResult(ok=True, message=f"{row[0]} is now on {row[1]}.")


@router.get("/tenants/{tenant_id}", response_model=TenantDetail,
            summary="Everything about one workspace")
async def get_tenant_detail(
    tenant_id: uuid.UUID,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> TenantDetail:
    """The page a support ticket is answered from.

    The console was a list you could not click into, so an email arrived and
    there was nowhere to look. This gathers what actually gets asked: where
    their sites are, what plan they are on and how close to its caps, whether
    they are set up enough to take a booking at all, who their staff are and
    whether any of them can still sign in.

    Configuration is reported as booleans. A support view must never become a
    way to read customers' API keys.
    """
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    t = (
        await session.execute(
            text(
                "SELECT tenant_id, slug, legal_name, trading_name, status, "
                "       primary_email, primary_phone, created_at, deleted_at, "
                "       subscription_tier, trial_ends_at, subscription_ends_at, "
                "       default_currency, default_timezone, "
                "       tos_accepted_at, tos_version, "
                "       GREATEST(0, :grace - EXTRACT(day FROM now() - deleted_at)::int) "
                "         AS restore_days_left "
                "  FROM tenants WHERE tenant_id = :t"
            ),
            {"t": str(tenant_id), "grace": _PURGE_GRACE_DAYS},
        )
    ).mappings().first()
    if not t:
        raise HTTPException(404, "No such workspace.")

    # Adopt the tenant so RLS scopes everything below to it.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )

    counts = (
        await session.execute(
            text(
                "SELECT (SELECT count(*) FROM staff_users WHERE is_active) AS staff,"
                "       (SELECT count(*) FROM locations WHERE is_active)   AS locations,"
                "       (SELECT count(*) FROM vehicles WHERE deleted_at IS NULL) AS vehicles,"
                "       (SELECT count(*) FROM reservations)                AS reservations,"
                "       (SELECT count(*) FROM reservations "
                "          WHERE created_at > now() - interval '30 days')   AS reservations_30d,"
                "       (SELECT max(created_at) FROM reservations)          AS last_reservation_at,"
                "       (SELECT count(*) FROM rate_codes WHERE status='ACTIVE') AS active_rates,"
                "       (SELECT count(*) FROM extras_catalog "
                "          WHERE default_price IS NOT NULL)                 AS priced_extras,"
                "       (SELECT count(*) FROM locations "
                "          WHERE tax_template_id IS NOT NULL)               AS locations_with_tax"
            )
        )
    ).mappings().first() or {}

    staff = [
        dict(r)
        for r in (
            await session.execute(
                text(
                    "SELECT user_id::text, email, role, is_active, "
                    "       last_login_at, email_verified_at, is_mfa_enabled, "
                    "       locked_until "
                    "  FROM staff_users WHERE deleted_at IS NULL "
                    " ORDER BY is_active DESC, role, email"
                )
            )
        ).mappings().all()
    ]

    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    scheme = settings.public_url_scheme
    return TenantDetail(
        tenant_id=t["tenant_id"],
        slug=t["slug"],
        name=t["legal_name"],
        trading_name=t["trading_name"],
        status=t["status"],
        primary_email=t["primary_email"],
        primary_phone=t["primary_phone"],
        created_at=t["created_at"],
        deleted_at=t["deleted_at"],
        restore_days_left=t["restore_days_left"] if t["deleted_at"] else None,
        subscription_tier=t["subscription_tier"],
        trial_ends_at=t["trial_ends_at"],
        subscription_ends_at=t["subscription_ends_at"],
        currency=t["default_currency"],
        timezone=t["default_timezone"],
        tos_accepted_at=t["tos_accepted_at"],
        tos_version=t["tos_version"],
        booking_url=f"{scheme}://{tenant_host(t['slug'], settings.public_booking_host)}",
        admin_url=f"{scheme}://{tenant_host(t['slug'], settings.public_admin_host)}",
        counter_url=f"{scheme}://{tenant_host(t['slug'], settings.public_counter_host)}",
        staff_count=counts.get("staff", 0),
        locations=counts.get("locations", 0),
        vehicles=counts.get("vehicles", 0),
        reservations=counts.get("reservations", 0),
        reservations_30d=counts.get("reservations_30d", 0),
        last_reservation_at=counts.get("last_reservation_at"),
        active_rate_codes=counts.get("active_rates", 0),
        priced_extras=counts.get("priced_extras", 0),
        locations_with_tax=counts.get("locations_with_tax", 0),
        staff=staff,
        is_self=False,
    )
