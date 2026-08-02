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

import re
import secrets
import uuid
from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session_untenanted
from app.core.platform_security import PlatformClaims, get_current_platform_admin
from app.core.ratelimit import enforce_limit
from app.core.config import settings
from app.core.tenancy import (
    RESERVED_SLUGS,
    invalidate_slug_cache,
    tenant_host,
)
from app.core.security import bump_epoch, hash_password
from app.domains.tenants.limits import assert_within_limit
from app.core.mailer import send_email, wrap_html
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

async def _revoke_sessions_for_user(session: AsyncSession, user_id: str) -> None:
    """End every live session belonging to one person.

    The epoch in Postgres is the durable half — it invalidates tokens this
    process cannot enumerate, refresh tokens included — and the JTI sweep makes
    it take effect now instead of when the epoch cache expires. Redis being
    down must not make a deactivation silently fail, so the sweep is
    best-effort; the epoch is already written by then and is what holds.
    """
    from app.core.redis import REVOKED_TOKENS_SET, get_session_redis
    from app.domains.auth.service import USER_SESSIONS_KEY

    await bump_epoch(session, user_id)
    try:
        redis = get_session_redis()
        jtis = await redis.smembers(USER_SESSIONS_KEY.format(user_id=user_id))
        if jtis:
            await redis.sadd(REVOKED_TOKENS_SET, *jtis)
        await redis.delete(USER_SESSIONS_KEY.format(user_id=user_id))
    except Exception:  # noqa: BLE001 — the epoch is the durable half
        log.warning("session_sweep_failed", user_id=user_id, exc_info=True)


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

    # Clearing the term matters as much as setting the status. A workspace that
    # expired did so because a date is in the past; flipping only the status
    # would leave that date where it is, and the nightly sweep would lock the
    # customer straight back out at 03:35 — a reactivation that reports success
    # and silently reverses itself overnight. NULL means "not on a clock",
    # which is the right state for a term granted by hand: billing sets a real
    # one when it takes over.
    res = await session.execute(
        text(
            "UPDATE tenants "
            "   SET status = 'ACTIVE', "
            "       trial_ends_at = NULL, "
            "       subscription_ends_at = NULL, "
            "       expired_at = NULL, "
            "       reactivation_token = NULL, "
            "       expiry_warn_stage = 0, "
            "       expiry_warned_at = NULL, "
            "       status_before_expiry = NULL, "
            "       updated_at = now() "
            " WHERE tenant_id = :t AND deleted_at IS NULL RETURNING slug, status"
        ),
        {"t": str(tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such workspace.")

    await invalidate_slug_cache(row[0])
    log.info("platform_tenant_reactivated", slug=row[0], by=str(claims.admin_id))
    return ActionResult(
        ok=True,
        message=f"{row[0]} is active again, with no end date set.",
    )


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
        # Archived plans are excluded. Archiving is the operation offered
        # wherever deletion is refused, and it is meant to stop NEW
        # assignments — if this list ignored is_active, "archive" would mean
        # nothing but a badge in the console, and the plans page would be
        # describing a control that does not exist. Workspaces already on an
        # archived plan stay on it; that is the whole point of archiving
        # instead of deleting.
        allowed = [
            r[0]
            for r in (
                await session.execute(
                    text(
                        "SELECT code FROM plans WHERE is_active "
                        " ORDER BY sort_order, code"
                    )
                )
            ).all()
        ]
        # Checked against the plans catalogue rather than a constant, because a plan
        # with no limits row silently reads as "unlimited" downstream — which
        # is how PROFESSIONAL came to grant Enterprise capacity for Starter
        # money. If it cannot be metered, it cannot be sold.
        if tier not in allowed:
            raise HTTPException(
                400,
                f"Cannot assign '{tier}'. Available plans: {', '.join(allowed)}. "
                f"An archived plan can be kept but not newly assigned.",
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


# ── Operator-initiated password reset ────────────────────────────────────────

class ResetInitiated(BaseModel):
    ok: bool = True
    sent_to: str
    message: str


@router.post("/tenants/{tenant_id}/staff/{user_id}/password-reset",
             response_model=ResetInitiated)
async def send_staff_password_reset(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ResetInitiated:
    """Email a customer's staff member a recovery link, on request.

    The support call this answers is "our manager is locked out and the reset
    email never arrives". Until now the only answer was to talk them through
    the self-serve form, which does not help when the address on the account is
    a mailbox they no longer read, or when they cannot recall which of the
    workspace addresses they signed up with.

    What an operator can do here is *start* the flow. What they cannot do:

      * choose where the link goes. The destination is read from the account
        row below and is never taken from the request. Accepting an address
        here would turn a support tool into a one-click takeover of any account
        on the platform — the same shape as the Origin-header hole this
        codebase already had once.
      * see the link, or the token. Neither is returned, and only the hash is
        stored. An operator who wanted to use it would have to read the
        customer's mailbox.
      * set a password. There is no endpoint for that and this does not add
        one. The person who ends up knowing the new password is the account
        holder, and only them.

    The reset itself is the ordinary one: single-use, one hour, and redeeming
    it ends every existing session for that account.
    """
    # Modest, and per operator rather than per target: a support desk works
    # through several people in a sitting, but nobody legitimately fires
    # hundreds. Sized to be invisible in real use and obvious in abuse.
    await enforce_limit(
        request, bucket="platform-pwreset", limit=30, window_seconds=3600,
        subject=str(claims.admin_id),
        message="Too many resets started. Try again shortly.",
    )

    # Adopt the target workspace: staff_users is under RLS and this session
    # carries no tenant. Rule 3 — name the tenant, see only that tenant.
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    tenant = (
        await session.execute(
            text(
                "SELECT slug, COALESCE(trading_name, legal_name, slug) AS name, "
                "       deleted_at "
                "  FROM tenants WHERE tenant_id = :t"
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().first()
    if not tenant:
        raise HTTPException(status_code=404, detail="No such workspace.")
    if tenant["deleted_at"]:
        # A deleted workspace cannot be signed into, so a link would be a dead
        # end. Restore it first — which is the thing the operator actually
        # meant to do.
        raise HTTPException(
            status_code=409,
            detail="This workspace is deleted. Restore it before resetting a password.",
        )

    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )
    user = (
        await session.execute(
            text(
                "SELECT email, is_active FROM staff_users "
                " WHERE user_id = :u AND tenant_id = :t AND deleted_at IS NULL"
            ),
            {"u": str(user_id), "t": str(tenant_id)},
        )
    ).mappings().first()
    if not user:
        raise HTTPException(status_code=404, detail="No such person in this workspace.")
    if not user["is_active"]:
        # Sending one would be worse than refusing: the link works, and the
        # sign-in that follows does not. Reactivate first.
        raise HTTPException(
            status_code=409,
            detail="This account is deactivated. Reactivate it before resetting the password.",
        )

    from app.domains.auth.service import AuthService

    link = await AuthService(session).mint_reset_link(
        user_id=str(user_id), tenant_id=str(tenant_id), slug=tenant["slug"],
    )

    # Says who started it. Somebody receiving an unexpected reset email should
    # be able to tell a support action from an attack on their account.
    html = wrap_html(
        "Reset your password",
        f"<p>Support started a password reset for your "
        f"<strong>{tenant['name']}</strong> account at your request. This link "
        f"expires in one hour and can be used once.</p>"
        "<p>If you did not ask for this, ignore this email — your password will "
        "not change — and tell your workspace administrator.</p>",
        cta_text="Choose a new password", cta_url=link,
    )
    transport = await send_email(
        to_email=user["email"],
        subject="Reset your RCM password",
        html=html,
        kind="password_reset",
    )

    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    log.warning(
        "platform_password_reset_initiated",
        by=str(claims.admin_id),
        by_email=claims.email,
        tenant_id=str(tenant_id),
        slug=tenant["slug"],
        target_user=str(user_id),
        transport=transport,
        # The link is never logged. Only its hash exists, in Redis.
    )

    return ResetInitiated(
        sent_to=user["email"],
        message=f"Recovery link sent to {user['email']}. It expires in one hour.",
    )


# ── Managing the people inside a workspace ───────────────────────────────────

# The roles a workspace's staff may hold. Deliberately narrower than the
# user_role enum, which also carries CUSTOMER, CORPORATE_BOOKER, API_PARTNER and
# AGENT_SERVICE — those are not employees and must not be creatable here, or the
# console becomes a way to mint an API principal inside a customer's account.
_ASSIGNABLE_ROLES = (
    "SUPER_ADMIN", "SYSTEM_ADMIN", "EXECUTIVE", "REGIONAL_MANAGER",
    "BRANCH_MANAGER", "FLEET_MANAGER", "FINANCE", "FINANCE_ANALYST",
    "CLAIMS_COORDINATOR", "SENIOR_AGENT", "MAINTENANCE_TECH", "COUNTER_AGENT",
    "READONLY_AUDITOR",
)
_ADMIN_ROLES = ("SYSTEM_ADMIN", "SUPER_ADMIN")


class StaffCreate(BaseModel):
    email: EmailStr
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(default="", max_length=80)
    role: str

    @field_validator("role")
    @classmethod
    def _known_role(cls, v: str) -> str:
        if v not in _ASSIGNABLE_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(_ASSIGNABLE_ROLES)}")
        return v


class StaffPatch(BaseModel):
    """Everything about a person that support may correct.

    Note what is absent: `email`. It is not an oversight and it is not a
    to-do.

    The console can start a password reset, and that reset goes to the address
    on the account. If it could also change that address, the two together
    would be a complete account takeover in two clicks — point the account at
    a mailbox you control, then reset into it. Excluding the field is what
    keeps "an operator can never sign in as a customer" true rather than
    merely intended.

    A genuine address correction is a request the workspace's own
    administrator makes, from their own back office, where it is their action
    on their own team.
    """
    first_name: str | None = Field(default=None, min_length=1, max_length=80)
    last_name: str | None = Field(default=None, max_length=80)
    role: str | None = None
    is_active: bool | None = None

    @field_validator("role")
    @classmethod
    def _known_role(cls, v: str | None) -> str | None:
        if v is not None and v not in _ASSIGNABLE_ROLES:
            raise ValueError(f"Role must be one of: {', '.join(_ASSIGNABLE_ROLES)}")
        return v


async def _bind_tenant(session: AsyncSession, tenant_id: uuid.UUID) -> dict:
    """Adopt one workspace and return it. 404 if it is not there to adopt."""
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    row = (
        await session.execute(
            text(
                "SELECT slug, COALESCE(trading_name, legal_name, slug) AS name, "
                "       deleted_at FROM tenants WHERE tenant_id = :t"
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No such workspace.")
    if row["deleted_at"]:
        raise HTTPException(
            status_code=409,
            detail="This workspace is deleted. Restore it before changing its people.",
        )
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )
    return dict(row)


async def _live_admin_count(session: AsyncSession, tenant_id: uuid.UUID) -> int:
    return (
        await session.execute(
            text(
                "SELECT count(*) FROM staff_users "
                " WHERE tenant_id = :t AND is_active AND deleted_at IS NULL "
                "   AND role IN ('SYSTEM_ADMIN','SUPER_ADMIN')"
            ),
            {"t": str(tenant_id)},
        )
    ).scalar() or 0


async def _assert_not_last_admin(
    session: AsyncSession, tenant_id: uuid.UUID, current_role: str, verb: str
) -> None:
    """A workspace with no administrator cannot be administered by anyone.

    Not even by this console: nothing here can grant a role to somebody who no
    longer has an account, and the customer has no way back in. Refuse while
    the situation is still recoverable.
    """
    if current_role in _ADMIN_ROLES and await _live_admin_count(session, tenant_id) <= 1:
        raise HTTPException(
            status_code=409,
            detail=(
                f"This is the workspace's last administrator, so they cannot be "
                f"{verb}. Give someone else the administrator role first."
            ),
        )


@router.post("/tenants/{tenant_id}/staff", response_model=ResetInitiated,
             status_code=status.HTTP_201_CREATED)
async def create_staff_member(
    tenant_id: uuid.UUID,
    payload: StaffCreate,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ResetInitiated:
    """Add a person to a workspace and email them a link to set their password.

    No password is accepted and none is generated for anyone to read. The row
    is created with a random hash nobody holds, so the emailed link is the only
    path into the account and the person who ends up knowing the password is
    the account holder — same guarantee as the reset endpoint above.
    """
    await enforce_limit(
        request, bucket="platform-staff-write", limit=60, window_seconds=3600,
        subject=str(claims.admin_id),
        message="Too many changes. Try again shortly.",
    )
    tenant = await _bind_tenant(session, tenant_id)

    # The console is a support tool, not an exemption. Adding people here
    # bypassed the seat cap entirely while the workspace's own invite flow
    # enforced it — so the way around a plan limit was to ask support.
    await assert_within_limit(session, tenant_id, "staff")

    email = payload.email.strip().lower()

    # uq_staff_email_tenant covers soft-deleted rows too, so a plain INSERT
    # after a removal fails on a person who is, as far as anyone can see, gone.
    # Reinstating the existing row is both what the operator meant and the only
    # thing the constraint permits.
    existing = (
        await session.execute(
            text(
                "SELECT user_id::text, deleted_at IS NOT NULL AS removed, is_active "
                "  FROM staff_users WHERE tenant_id = :t AND lower(email) = :e"
            ),
            {"t": str(tenant_id), "e": email},
        )
    ).mappings().first()

    if existing and not existing["removed"]:
        raise HTTPException(
            status_code=409,
            detail="Someone in this workspace already uses that address.",
        )

    now = datetime.now(timezone.utc)
    if existing:
        user_id = existing["user_id"]
        await session.execute(
            text(
                "UPDATE staff_users "
                "   SET deleted_at = NULL, is_active = true, "
                "       first_name = :f, last_name = :l, "
                "       role = CAST(:r AS user_role), "
                "       password_hash = :pw, email_verified_at = NULL, "
                "       failed_login_count = 0, locked_until = NULL, "
                "       updated_at = :now "
                " WHERE user_id = :u AND tenant_id = :t"
            ),
            {
                "u": user_id, "t": str(tenant_id),
                "f": payload.first_name, "l": payload.last_name, "r": payload.role,
                # Unguessable and never revealed, here or anywhere. The emailed
                # link is the only way in.
                "pw": hash_password(secrets.token_urlsafe(32)), "now": now,
            },
        )
        # A reinstated account keeps its user_id, and so would keep any tokens
        # minted before removal. Kill them.
        await bump_epoch(session, user_id)
    else:
        user_id = str(uuid.uuid4())
        await session.execute(
            text(
                "INSERT INTO staff_users ("
                "  user_id, tenant_id, email, password_hash, first_name, last_name,"
                "  role, is_active, location_ids, created_at, updated_at,"
                "  is_mfa_enabled, failed_login_count, phone_verified"
                ") VALUES ("
                "  :u, :t, :e, :pw, :f, :l, CAST(:r AS user_role), true, '{}',"
                "  :now, :now, false, 0, false)"
            ),
            {
                "u": user_id, "t": str(tenant_id), "e": email,
                "pw": hash_password(secrets.token_urlsafe(32)),
                "f": payload.first_name, "l": payload.last_name,
                "r": payload.role, "now": now,
            },
        )

    from app.domains.auth.service import AuthService

    link = await AuthService(session).mint_reset_link(
        user_id=user_id, tenant_id=str(tenant_id), slug=tenant["slug"],
    )
    html = wrap_html(
        f"Your {tenant['name']} account",
        f"<p>An account has been created for you on <strong>{tenant['name']}</strong>. "
        "Choose a password to finish setting it up — this link expires in one "
        "hour and can be used once.</p>"
        "<p>If you were not expecting this, ignore this email and tell your "
        "workspace administrator.</p>",
        cta_text="Set your password", cta_url=link,
    )
    transport = await send_email(
        to_email=email, subject=f"Set up your {tenant['name']} account",
        html=html, kind="password_reset",
    )

    await session.commit()
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    log.warning(
        "platform_staff_created", by=str(claims.admin_id), by_email=claims.email,
        tenant_id=str(tenant_id), slug=tenant["slug"], target_user=user_id,
        role=payload.role, reinstated=bool(existing), transport=transport,
    )
    return ResetInitiated(
        sent_to=email,
        message=f"Account created. A link to set a password was sent to {email}.",
    )


@router.patch("/tenants/{tenant_id}/staff/{user_id}", response_model=ActionResult)
async def update_staff_member(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    payload: StaffPatch,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Correct a person's name, role, or whether they may sign in.

    Their email address is not editable here — see StaffPatch for why.
    """
    await enforce_limit(
        request, bucket="platform-staff-write", limit=60, window_seconds=3600,
        subject=str(claims.admin_id),
        message="Too many changes. Try again shortly.",
    )
    tenant = await _bind_tenant(session, tenant_id)

    target = (
        await session.execute(
            text(
                "SELECT email, role::text AS role, is_active FROM staff_users "
                " WHERE user_id = :u AND tenant_id = :t AND deleted_at IS NULL"
            ),
            {"u": str(user_id), "t": str(tenant_id)},
        )
    ).mappings().first()
    if not target:
        raise HTTPException(status_code=404, detail="No such person in this workspace.")

    # Reactivating consumes a seat. team_router's reactivate has always checked
    # this; the console's did not, so a workspace at its cap could be pushed
    # over it by turning someone back on.
    if payload.is_active is True and not target["is_active"]:
        await assert_within_limit(session, tenant_id, "staff")

    losing_admin = (
        payload.is_active is False
        or (payload.role is not None and payload.role not in _ADMIN_ROLES)
    )
    if losing_admin:
        await _assert_not_last_admin(
            session, tenant_id, target["role"],
            "deactivated" if payload.is_active is False else "moved off the administrator role",
        )

    sets, params = [], {"u": str(user_id), "t": str(tenant_id)}
    if payload.first_name is not None:
        sets.append("first_name = :f"); params["f"] = payload.first_name
    if payload.last_name is not None:
        sets.append("last_name = :l"); params["l"] = payload.last_name
    if payload.role is not None:
        sets.append("role = CAST(:r AS user_role)"); params["r"] = payload.role
    if payload.is_active is not None:
        sets.append("is_active = :a"); params["a"] = payload.is_active
    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    sets.append("updated_at = now()")
    await session.execute(
        text(
            f"UPDATE staff_users SET {', '.join(sets)} "
            " WHERE user_id = :u AND tenant_id = :t AND deleted_at IS NULL"
        ),
        params,
    )

    # A role carried in a live token would otherwise outlast the change by up
    # to a counter shift. Deactivation without this is not deactivation at all.
    reauth = payload.role is not None or payload.is_active is not None
    if reauth:
        await _revoke_sessions_for_user(session, str(user_id))

    await session.commit()
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    log.warning(
        "platform_staff_updated", by=str(claims.admin_id), by_email=claims.email,
        tenant_id=str(tenant_id), slug=tenant["slug"], target_user=str(user_id),
        changed=sorted(k for k in payload.model_dump(exclude_none=True)),
        signed_out=reauth,
    )
    return ActionResult(
        ok=True,
        message=(
            f"Updated {target['email']}."
            + (" They have been signed out everywhere." if reauth else "")
        ),
    )


@router.delete("/tenants/{tenant_id}/staff/{user_id}", response_model=ActionResult)
async def remove_staff_member(
    tenant_id: uuid.UUID,
    user_id: uuid.UUID,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Remove a person from a workspace.

    The row is retained with deleted_at set, and this is not squeamishness: it
    is referenced by the rentals they checked out, the damage they recorded and
    the customers they flagged. Erasing it would either break those references
    or rewrite history to say nobody did the work.

    What removal means in practice is the part that matters: the account cannot
    sign in, every existing session is dead, and the person disappears from the
    workspace's team list. Purging a whole workspace still deletes these rows
    outright, which is where erasure belongs.
    """
    await enforce_limit(
        request, bucket="platform-staff-write", limit=60, window_seconds=3600,
        subject=str(claims.admin_id),
        message="Too many changes. Try again shortly.",
    )
    tenant = await _bind_tenant(session, tenant_id)

    target = (
        await session.execute(
            text(
                "SELECT email, role::text AS role FROM staff_users "
                " WHERE user_id = :u AND tenant_id = :t AND deleted_at IS NULL"
            ),
            {"u": str(user_id), "t": str(tenant_id)},
        )
    ).mappings().first()
    if not target:
        raise HTTPException(status_code=404, detail="No such person in this workspace.")

    await _assert_not_last_admin(session, tenant_id, target["role"], "removed")

    await session.execute(
        text(
            "UPDATE staff_users "
            "   SET deleted_at = now(), is_active = false, updated_at = now() "
            " WHERE user_id = :u AND tenant_id = :t"
        ),
        {"u": str(user_id), "t": str(tenant_id)},
    )
    await _revoke_sessions_for_user(session, str(user_id))
    await session.commit()
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    log.warning(
        "platform_staff_removed", by=str(claims.admin_id), by_email=claims.email,
        tenant_id=str(tenant_id), slug=tenant["slug"], target_user=str(user_id),
        role=target["role"],
    )
    return ActionResult(
        ok=True,
        message=f"{target['email']} removed and signed out everywhere.",
    )


# ── The plan catalogue ───────────────────────────────────────────────────────
#
# A plan is a row in `plans` and tenants.subscription_tier is a foreign key to
# it. That FK is doing real work here: the database refuses to delete a plan
# somebody is on, so the guard below is a better error message rather than the
# thing standing between a customer and a broken account.

_BILLING_PERIODS = ("MONTHLY", "YEARLY", "CUSTOM")
_CODE_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,31}$")


class PlanIn(BaseModel):
    code: str = Field(description="Immutable-ish identifier, e.g. GROWTH")
    display_name: str = Field(min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=400)
    # None means unlimited, everywhere. Enterprise needs no special case.
    max_staff: int | None = Field(default=None, gt=0)
    max_vehicles: int | None = Field(default=None, gt=0)
    max_locations: int | None = Field(default=None, gt=0)
    price_cents: int | None = Field(default=None, ge=0)
    currency: str = Field(default="USD", min_length=3, max_length=3)
    billing_period: str = "MONTHLY"
    is_active: bool = True
    sort_order: int = 100

    @field_validator("code")
    @classmethod
    def _code_shape(cls, v: str) -> str:
        v = v.strip().upper()
        if not _CODE_RE.match(v):
            raise ValueError(
                "Code must be 2–32 characters: A–Z, 0–9 and underscore, "
                "starting with a letter."
            )
        return v

    @field_validator("billing_period")
    @classmethod
    def _period(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in _BILLING_PERIODS:
            raise ValueError(f"Billing period must be one of: {', '.join(_BILLING_PERIODS)}")
        return v

    @field_validator("currency")
    @classmethod
    def _currency(cls, v: str) -> str:
        return v.strip().upper()


class PlanPatch(BaseModel):
    """Every attribute of a plan is editable except its code.

    The code is a foreign key target. ON UPDATE CASCADE would carry a rename
    through to every tenant safely, but a code is also what appears in logs,
    exports and support conversations — renaming it silently rewrites history
    that people have already read. display_name is the label; change that.
    """
    display_name: str | None = Field(default=None, min_length=1, max_length=60)
    description: str | None = Field(default=None, max_length=400)
    max_staff: int | None = Field(default=None, gt=0)
    max_vehicles: int | None = Field(default=None, gt=0)
    max_locations: int | None = Field(default=None, gt=0)
    price_cents: int | None = Field(default=None, ge=0)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    billing_period: str | None = None
    is_active: bool | None = None
    is_default: bool | None = None
    sort_order: int | None = None
    # A cap set to None means unlimited, which is indistinguishable from "not
    # supplied" in a PATCH body. Name the ones to clear explicitly.
    unlimited: list[str] = Field(default_factory=list)

    @field_validator("billing_period")
    @classmethod
    def _period(cls, v: str | None) -> str | None:
        if v is None:
            return None
        v = v.strip().upper()
        if v not in _BILLING_PERIODS:
            raise ValueError(f"Billing period must be one of: {', '.join(_BILLING_PERIODS)}")
        return v

    @field_validator("unlimited")
    @classmethod
    def _caps(cls, v: list[str]) -> list[str]:
        allowed = {"max_staff", "max_vehicles", "max_locations"}
        bad = [c for c in v if c not in allowed]
        if bad:
            raise ValueError(f"Not a cap: {', '.join(bad)}")
        return v


class Plan(BaseModel):
    code: str
    display_name: str
    description: str | None = None
    max_staff: int | None = None
    max_vehicles: int | None = None
    max_locations: int | None = None
    price_cents: int | None = None
    currency: str = "USD"
    billing_period: str = "MONTHLY"
    is_active: bool = True
    is_default: bool = False
    sort_order: int = 100
    # What makes the page safe to act on: you can see what deleting would cost
    # before you try.
    tenants: int = 0


_PLAN_COLUMNS = (
    "code, display_name, description, max_staff, max_vehicles, max_locations, "
    "price_cents, currency, billing_period, is_active, is_default, sort_order"
)


async def _plan_rows(session: AsyncSession) -> list[dict]:
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    return [
        dict(r)
        for r in (
            await session.execute(
                text(
                    f"SELECT {_PLAN_COLUMNS}, "
                    "       (SELECT count(*) FROM tenants t "
                    "         WHERE t.subscription_tier = p.code "
                    "           AND t.deleted_at IS NULL) AS tenants "
                    "  FROM plans p ORDER BY p.sort_order, p.code"
                )
            )
        ).mappings().all()
    ]


@router.get("/plans", response_model=list[Plan])
async def list_plans(
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> list[Plan]:
    return [Plan(**r) for r in await _plan_rows(session)]


@router.post("/plans", response_model=Plan, status_code=status.HTTP_201_CREATED)
async def create_plan(
    payload: PlanIn,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> Plan:
    """Add a plan. Before migration 074 this needed a schema change."""
    await enforce_limit(
        request, bucket="platform-plans", limit=60, window_seconds=3600,
        subject=str(claims.admin_id), message="Too many changes. Try again shortly.",
    )
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    if (
        await session.execute(
            text("SELECT 1 FROM plans WHERE code = :c"), {"c": payload.code}
        )
    ).first():
        raise HTTPException(status_code=409, detail=f"A plan called {payload.code} already exists.")

    await session.execute(
        text(
            "INSERT INTO plans (code, display_name, description, max_staff, "
            "  max_vehicles, max_locations, price_cents, currency, "
            "  billing_period, is_active, sort_order, updated_at) "
            "VALUES (:code, :display_name, :description, :max_staff, "
            "  :max_vehicles, :max_locations, :price_cents, :currency, "
            "  :billing_period, :is_active, :sort_order, now())"
        ),
        payload.model_dump(),
    )
    await session.commit()

    log.warning("platform_plan_created", by=str(claims.admin_id),
                by_email=claims.email, code=payload.code)
    rows = [r for r in await _plan_rows(session) if r["code"] == payload.code]
    return Plan(**rows[0])


@router.patch("/plans/{code}", response_model=Plan)
async def update_plan(
    code: str,
    payload: PlanPatch,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> Plan:
    """Change a plan's attributes.

    Caps take effect at the next creation attempt, not retroactively: a
    workspace already over a lowered cap keeps working and simply cannot add
    more. Disabling data somebody is mid-rental with would be worse than the
    overage — see domains/tenants/limits.py.
    """
    await enforce_limit(
        request, bucket="platform-plans", limit=60, window_seconds=3600,
        subject=str(claims.admin_id), message="Too many changes. Try again shortly.",
    )
    code = code.strip().upper()
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    current = (
        await session.execute(
            text("SELECT is_default, is_active FROM plans WHERE code = :c"), {"c": code}
        )
    ).mappings().first()
    if not current:
        raise HTTPException(status_code=404, detail="No such plan.")

    sets: list[str] = []
    params: dict = {"c": code}
    for field in (
        "display_name", "description", "max_staff", "max_vehicles",
        "max_locations", "price_cents", "currency", "billing_period",
        "is_active", "sort_order",
    ):
        value = getattr(payload, field)
        if value is not None:
            sets.append(f"{field} = :{field}")
            params[field] = value

    for cap in payload.unlimited:
        sets.append(f"{cap} = NULL")
        params.pop(cap, None)
        sets = [s for s in sets if s != f"{cap} = :{cap}"]

    # Signups land on the default plan, so it must stay assignable. Archiving it
    # would send every new workspace to the COALESCE fallback in the signup
    # insert — working, but not what anyone configured.
    if payload.is_active is False and current["is_default"]:
        raise HTTPException(
            status_code=409,
            detail="This is the plan new signups get. Make another plan the default first.",
        )

    if payload.is_default is True:
        if payload.is_active is False:
            raise HTTPException(
                status_code=409, detail="An archived plan cannot be the signup default.",
            )
        if not current["is_active"] and payload.is_active is not True:
            raise HTTPException(
                status_code=409,
                detail="This plan is archived. Reactivate it before making it the default.",
            )
        # One default, and the unique index says so. Clear the incumbent in the
        # same transaction or the index rejects the write.
        await session.execute(text("UPDATE plans SET is_default = false WHERE is_default"))
        sets.append("is_default = true")
    elif payload.is_default is False and current["is_default"]:
        raise HTTPException(
            status_code=409,
            detail="Make another plan the default instead — signups need one.",
        )

    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    sets.append("updated_at = now()")
    await session.execute(
        text(f"UPDATE plans SET {', '.join(sets)} WHERE code = :c"), params
    )
    await session.commit()

    log.warning("platform_plan_updated", by=str(claims.admin_id), by_email=claims.email,
                code=code, changed=sorted(params.keys() - {"c"}) + payload.unlimited)
    rows = [r for r in await _plan_rows(session) if r["code"] == code]
    return Plan(**rows[0])


@router.delete("/plans/{code}", response_model=ActionResult)
async def delete_plan(
    code: str,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> ActionResult:
    """Delete a plan nobody is on.

    A plan with workspaces on it is not deletable and should not be: the
    foreign key would refuse, and even if it cascaded, the result would be
    workspaces with no plan and therefore no limits. Archiving is the operation
    that was actually wanted — it stops new assignments and leaves everyone
    where they are — so the error says so rather than just refusing.
    """
    await enforce_limit(
        request, bucket="platform-plans", limit=60, window_seconds=3600,
        subject=str(claims.admin_id), message="Too many changes. Try again shortly.",
    )
    code = code.strip().upper()
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))

    row = (
        await session.execute(
            text(
                "SELECT p.is_default, "
                "       (SELECT count(*) FROM tenants t "
                "         WHERE t.subscription_tier = p.code) AS tenants "
                "  FROM plans p WHERE p.code = :c"
            ),
            {"c": code},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status_code=404, detail="No such plan.")

    if row["tenants"]:
        n = row["tenants"]
        raise HTTPException(
            status_code=409,
            detail=(
                f"{n} workspace{'s are' if n != 1 else ' is'} on this plan. "
                "Move them to another plan first, or archive this one to stop "
                "new assignments without disturbing them."
            ),
        )
    if row["is_default"]:
        raise HTTPException(
            status_code=409,
            detail="This is the plan new signups get. Make another plan the default first.",
        )

    await session.execute(text("DELETE FROM plans WHERE code = :c"), {"c": code})
    await session.commit()

    log.warning("platform_plan_deleted", by=str(claims.admin_id),
                by_email=claims.email, code=code)
    return ActionResult(ok=True, message=f"Plan {code} deleted.")


# ── Which capabilities a plan includes ───────────────────────────────────────

class FeatureCatalogue(BaseModel):
    key: str
    label: str
    blurb: str


class PlanFeatures(BaseModel):
    plan_code: str
    features: list[str]


@router.get("/features", response_model=list[FeatureCatalogue])
async def list_features(
    claims: PlatformClaims = Depends(require_platform_admin),
) -> list[FeatureCatalogue]:
    """The vocabulary of gateable capabilities.

    Served from the code registry, not from the database, so the console can
    only ever offer keys that a gate would actually recognise. A free-text
    field here would let an operator tick a box that grants nothing.
    """
    from app.domains.tenants.features import FEATURES

    return [FeatureCatalogue(key=f.key, label=f.label, blurb=f.blurb) for f in FEATURES]


@router.get("/plans/{code}/features", response_model=PlanFeatures)
async def get_plan_features(
    code: str,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> PlanFeatures:
    code = code.strip().upper()
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    if not (
        await session.execute(text("SELECT 1 FROM plans WHERE code = :c"), {"c": code})
    ).first():
        raise HTTPException(status_code=404, detail="No such plan.")

    rows = (
        await session.execute(
            text("SELECT feature_key FROM plan_features WHERE plan_code = :c"),
            {"c": code},
        )
    ).all()
    return PlanFeatures(plan_code=code, features=sorted(r[0] for r in rows))


@router.put("/plans/{code}/features", response_model=PlanFeatures)
async def set_plan_features(
    code: str,
    payload: PlanFeatures,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> PlanFeatures:
    """Replace the feature set for a plan.

    A PUT rather than add/remove endpoints: the console edits a set of
    checkboxes and submits the result, and two endpoints would let a dropped
    request leave the plan in a state matching neither what was there before nor
    what the operator saw on screen.

    Takes effect immediately for every workspace on the plan. There is no cache
    to invalidate — the gate reads the join on each request — and no grace
    period, which matters: removing a feature from a plan somebody is using
    revokes it mid-session. That is the right default for a control an operator
    reaches for deliberately, but it is worth knowing before clicking.
    """
    from app.domains.tenants.features import FEATURE_KEYS

    await enforce_limit(
        request, bucket="platform-plans", limit=60, window_seconds=3600,
        subject=str(claims.admin_id), message="Too many changes. Try again shortly.",
    )
    code = code.strip().upper()
    wanted = {k.strip() for k in payload.features if k.strip()}

    unknown = sorted(wanted - FEATURE_KEYS)
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Not a known capability: {', '.join(unknown)}. "
                "A key with no gate behind it would grant nothing."
            ),
        )

    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    if not (
        await session.execute(text("SELECT 1 FROM plans WHERE code = :c"), {"c": code})
    ).first():
        raise HTTPException(status_code=404, detail="No such plan.")

    await session.execute(
        text("DELETE FROM plan_features WHERE plan_code = :c"), {"c": code}
    )
    for key in sorted(wanted):
        await session.execute(
            text(
                "INSERT INTO plan_features (plan_code, feature_key) "
                "VALUES (:c, :k) ON CONFLICT DO NOTHING"
            ),
            {"c": code, "k": key},
        )
    await session.commit()

    log.warning("platform_plan_features_set", by=str(claims.admin_id),
                by_email=claims.email, code=code, features=sorted(wanted))
    return PlanFeatures(plan_code=code, features=sorted(wanted))
