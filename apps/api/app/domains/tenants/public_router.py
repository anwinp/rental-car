"""Public, unauthenticated tenant endpoints: sign-up and runtime config.

Everything here is reachable without a session, which shapes the design:

- It creates database rows and is therefore a spam target — rate-limited by IP.
- It must never disclose whether a given organisation or email already exists
  beyond what a slug check unavoidably reveals.
- It runs untenanted: registration creates the tenant it will belong to, so
  there is no tenant context to bind yet.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

import structlog

from app.core.config import settings
from app.core.database import get_session_untenanted
from app.core.redis import get_session_redis
from app.core.security import hash_password
from app.core.tenancy import (
    RESERVED_SLUGS,
    assert_tenant_trading,
    extract_slug,
    invalidate_slug_cache,
    tenant_host,
    tenant_id_for_slug,
)
from app.domains.tenants.provisioning import provision_tenant_defaults
from app.domains.tenants.verification import (
    consume_token,
    issue_token,
    resend_for_email,
    send_verification_email,
    verification_link,
)

router = APIRouter()
log = structlog.get_logger()

# 3-40 chars. The previous pattern made the middle group optional and
# therefore accepted a single character.
_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$")
_REGISTER_LIMIT = 5           # registrations ...
_REGISTER_WINDOW = 3600       # ... per IP per hour


# ── Schemas ──────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    company_name: str = Field(min_length=2, max_length=120)
    slug: str = Field(min_length=3, max_length=40)
    admin_first_name: str = Field(min_length=1, max_length=60)
    admin_last_name: str = Field(min_length=1, max_length=60)
    admin_email: EmailStr
    admin_password: str = Field(min_length=10, max_length=128)
    country_code: str = Field(default="US", min_length=2, max_length=2)
    timezone: str = Field(default="America/New_York", max_length=64)
    currency: str = Field(default="USD", min_length=3, max_length=3)

    @field_validator("slug")
    @classmethod
    def _valid_slug(cls, v: str) -> str:
        v = v.strip().lower()
        if not _SLUG_RE.match(v):
            raise ValueError(
                "Use 3–40 characters: lowercase letters, numbers and hyphens, "
                "starting and ending with a letter or number."
            )
        if v in RESERVED_SLUGS:
            raise ValueError("That workspace address is reserved. Choose another.")
        return v

    @field_validator("admin_password")
    @classmethod
    def _strong_password(cls, v: str) -> str:
        if not any(c.isupper() for c in v) or not any(c.isdigit() for c in v):
            raise ValueError(
                "Include at least one capital letter and one number."
            )
        return v


class RegisterResponse(BaseModel):
    tenant_id: uuid.UUID
    slug: str
    company_name: str
    status: str
    admin_email: str
    # The two surfaces a tenant gets. Separate URLs because they serve
    # different audiences: customers book, staff administer.
    booking_url: str
    admin_url: str
    # The counter PWA is the third tenant surface and was never returned, so a
    # new workspace was told about its storefront and back office and left to
    # discover that the counter app existed at all.
    counter_url: str
    workspace_url: str          # kept as an alias of admin_url for compatibility
    provisioned: list[str]
    verification_required: bool = True
    # True when the confirmation email actually reached a mail transport.
    email_sent: bool = False
    # Fallback ONLY when no transport was available and nothing was sent, and
    # never in production — otherwise anyone able to call this endpoint could
    # activate the workspace they just created. When mail is working this stays
    # null, because showing a link "in case" trains people to ignore the inbox.
    verification_link: str | None = None


class VerifyRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)


class VerifyResponse(BaseModel):
    ok: bool
    message: str
    slug: str | None = None


class ResendRequest(BaseModel):
    email: EmailStr


class SlugCheckResponse(BaseModel):
    slug: str
    available: bool
    reason: str | None = None
    # The address the workspace would actually get. Returned so the signup form
    # shows the real hostname instead of guessing one — it used to render a
    # hardcoded ".rcm.app", a domain this deployment does not serve.
    booking_url: str | None = None
    admin_url: str | None = None
    counter_url: str | None = None


class TenantConfigResponse(BaseModel):
    """Runtime configuration a front end fetches at boot.

    Served anonymously, so it carries nothing an unauthenticated visitor should
    not see: no counts, no plan tier, no internal identifiers beyond the tenant
    id the hostname already reveals.
    """

    tenant_id: uuid.UUID
    slug: str
    display_name: str
    status: str
    currency: str
    timezone: str
    logo_url: str | None = None
    booking_url: str | None = None
    admin_url: str | None = None


# ── Rate limiting ────────────────────────────────────────────────────────────

async def _enforce_rate_limit(request: Request) -> None:
    """Cap registrations per source address.

    An unauthenticated endpoint that writes rows and (later) sends email is a
    spam target. If Redis is unavailable the limiter fails OPEN deliberately —
    a cache outage should not take signup down — which is why it is one control
    among several rather than the only one.
    """
    client_ip = (request.client.host if request.client else "unknown")
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        client_ip = forwarded.split(",")[0].strip()

    try:
        redis = get_session_redis()
        key = f"register_rate:{client_ip}"
        count = await redis.incr(key)
        if count == 1:
            await redis.expire(key, _REGISTER_WINDOW)
        if count > _REGISTER_LIMIT:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many workspaces created from this address. Try again later.",
            )
    except HTTPException:
        raise
    except Exception:  # noqa: BLE001 — see docstring: fail open
        return


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/slug-available",
    response_model=SlugCheckResponse,
    summary="Check whether a workspace address is free",
)
async def slug_available(
    slug: str,
    session: AsyncSession = Depends(get_session_untenanted),
) -> SlugCheckResponse:
    candidate = (slug or "").strip().lower()

    if not _SLUG_RE.match(candidate):
        return SlugCheckResponse(
            slug=candidate,
            available=False,
            reason="Use 3–40 characters: lowercase letters, numbers and hyphens.",
        )
    if candidate in RESERVED_SLUGS:
        return SlugCheckResponse(
            slug=candidate, available=False, reason="That address is reserved."
        )

    taken = (
        await session.execute(
            text("SELECT 1 FROM tenants WHERE slug = :s"), {"s": candidate}
        )
    ).first()
    if taken:
        return SlugCheckResponse(
            slug=candidate, available=False, reason="Already taken."
        )
    scheme = settings.public_url_scheme
    return SlugCheckResponse(
        slug=candidate,
        available=True,
        booking_url=f"{scheme}://{tenant_host(candidate, settings.public_booking_host)}",
        admin_url=f"{scheme}://{tenant_host(candidate, settings.public_admin_host)}",
        counter_url=f"{scheme}://{tenant_host(candidate, settings.public_counter_host)}",
    )


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new organisation",
)
async def register(
    body: RegisterRequest,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
) -> RegisterResponse:
    """Create an organisation, its first administrator, and a working baseline.

    One transaction: a failure at any point leaves no half-built tenant behind.
    """
    await _enforce_rate_limit(request)

    taken = (
        await session.execute(
            text("SELECT 1 FROM tenants WHERE slug = :s"), {"s": body.slug}
        )
    ).first()
    if taken:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"The address '{body.slug}' is already taken. Choose another.",
        )

    tenant_id = uuid.uuid4()
    admin_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    # Unverified until the address is proven. The login path refuses every
    # non-ACTIVE status, so an unconfirmed workspace cannot be signed into.
    await session.execute(
        text(
            """
            INSERT INTO tenants (
                tenant_id, slug, legal_name, primary_email, billing_address,
                default_currency, default_timezone, subscription_tier,
                status, tos_accepted_at, created_at, updated_at
            ) VALUES (
                :id, :slug, :name, :email, '{}',
                :cur, :tz, 'STARTER',
                'PENDING_VERIFICATION', :now, :now, :now
            )
            """
        ),
        {
            "id": str(tenant_id),
            "slug": body.slug,
            "name": body.company_name,
            "email": str(body.admin_email),
            "cur": body.currency.upper(),
            "tz": body.timezone,
            "now": now,
        },
    )

    # From here on this transaction acts AS the new tenant. Every table below
    # enforces WITH CHECK (tenant_id = current_tenant), so without this the
    # first insert is rejected by RLS — which is the correct default: writing
    # into a tenant you have not identified as should fail. Registration is the
    # one legitimate case, and it becomes legitimate the moment the tenant row
    # exists, inside the same transaction.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )

    await session.execute(
        text(
            """
            INSERT INTO staff_users (
                user_id, tenant_id, email, password_hash, first_name, last_name,
                role, is_active, location_ids, created_at, updated_at,
                is_mfa_enabled, failed_login_count, phone_verified
            ) VALUES (
                :uid, :tid, :email, :pw, :first, :last,
                'SYSTEM_ADMIN', true, '{}', :now, :now,
                false, 0, false
            )
            """
        ),
        {
            "uid": str(admin_id),
            "tid": str(tenant_id),
            "email": str(body.admin_email).lower(),
            "pw": hash_password(body.admin_password),
            "first": body.admin_first_name,
            "last": body.admin_last_name,
            "now": now,
        },
    )

    provisioned = await provision_tenant_defaults(
        session,
        tenant_id,
        location_name=f"{body.company_name} — Main Branch",
        location_code="MAIN",
        country_code=body.country_code.upper(),
        timezone=body.timezone,
        currency=body.currency.upper(),
    )

    await invalidate_slug_cache(body.slug)

    scheme = settings.public_url_scheme
    # Built through tenant_host, not string-concatenated. Composing these by
    # hand produced acme.rcm.ceez.ai — two labels below the registered domain,
    # which a DNS wildcard does not cover — so every workspace was handed a URL
    # that did not resolve.
    booking_url = f"{scheme}://{tenant_host(body.slug, settings.public_booking_host)}"
    admin_url = f"{scheme}://{tenant_host(body.slug, settings.public_admin_host)}"
    counter_url = f"{scheme}://{tenant_host(body.slug, settings.public_counter_host)}"

    # Mint the confirmation token inside the same transaction as the tenant, so
    # a workspace can never exist with no way to activate it.
    token = await issue_token(session, tenant_id, admin_id, str(body.admin_email))

    # The link points at the app the visitor is already using, not at a
    # tenant-specific host: they cannot reach their workspace until it is active.
    # The confirmation link must land on the app the visitor is using now —
    # they cannot reach their own workspace host until it is active.
    origin = request.headers.get("origin") or admin_url
    link = verification_link(token, origin)

    transport = await send_verification_email(
        to_email=str(body.admin_email),
        company=body.company_name,
        link=link,
        booking_url=booking_url,
        admin_url=admin_url,
        counter_url=counter_url,
    )
    log.info(
        "tenant_registered",
        slug=body.slug,
        tenant_id=str(tenant_id),
        mail_transport=transport,
    )

    # "log" means no transport was available and the link was only written to
    # the application log — the one case where the UI must surface it.
    email_sent = transport != "log"

    return RegisterResponse(
        tenant_id=tenant_id,
        slug=body.slug,
        company_name=body.company_name,
        status="PENDING_VERIFICATION",
        admin_email=str(body.admin_email),
        booking_url=booking_url,
        admin_url=admin_url,
        counter_url=counter_url,
        workspace_url=admin_url,
        provisioned=provisioned.steps,
        verification_required=True,
        email_sent=email_sent,
        verification_link=(
            None if email_sent or settings.env == "production" else link
        ),
    )


# ── POST /public/verify-email ────────────────────────────────────────────────


@router.post(
    "/verify-email",
    response_model=VerifyResponse,
    summary="Confirm an email address and activate the workspace",
)
async def verify_email(
    body: VerifyRequest,
    session: AsyncSession = Depends(get_session_untenanted),
) -> VerifyResponse:
    result = await consume_token(session, body.token)
    if result.ok and result.slug:
        await invalidate_slug_cache(result.slug)
    return VerifyResponse(ok=result.ok, message=result.message, slug=result.slug)


# ── POST /public/resend-verification ─────────────────────────────────────────


@router.post(
    "/resend-verification",
    response_model=VerifyResponse,
    summary="Send the confirmation email again",
)
async def resend_verification(
    body: ResendRequest,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
) -> VerifyResponse:
    """Always answers identically.

    Reporting "no such address" here would turn this into an oracle for which
    companies have signed up, so the response is the same whether or not
    anything was sent.
    """
    same_answer = VerifyResponse(
        ok=True,
        message="If that address has a workspace awaiting confirmation, "
                "a new link is on its way.",
    )

    outcome = await resend_for_email(session, str(body.email))
    if outcome is None:
        return same_answer

    token, tenant_id, _user_id = outcome
    row = (
        await session.execute(
            text("SELECT legal_name FROM tenants WHERE tenant_id = :t"),
            {"t": str(tenant_id)},
        )
    ).first()

    origin = request.headers.get("origin") or f"http://{request.headers.get('host', 'localhost')}"
    await send_verification_email(
        to_email=str(body.email),
        company=row[0] if row else "your",
        link=verification_link(token, origin),
    )
    return same_answer


@router.get(
    "/tenant-config",
    response_model=TenantConfigResponse,
    summary="Runtime configuration for a workspace",
)
async def tenant_config(
    request: Request,
    slug: str | None = None,
    session: AsyncSession = Depends(get_session_untenanted),
) -> TenantConfigResponse:
    """Resolve a workspace from its hostname (or an explicit slug).

    Front ends call this at boot instead of having a tenant compiled into the
    bundle, which is what lets one build serve every organisation.
    """
    candidate = (slug or extract_slug(request.headers.get("host", "")) or "").lower()
    if not candidate:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No workspace specified.",
        )

    tenant_id = await tenant_id_for_slug(session, candidate)
    if not tenant_id:
        # An unknown workspace is a 404, never a redirect to somebody else's.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No workspace found at '{candidate}'.",
        )

    # Every storefront boots from this call, so refusing here is what actually
    # stops a suspended workspace from trading. Status previously gated staff
    # login and nothing else: the back office and counter went dark while the
    # booking site kept taking reservations and charging cards.
    await assert_tenant_trading(session, tenant_id)

    row = (
        await session.execute(
            text(
                "SELECT slug, legal_name, trading_name, status, default_currency, "
                "default_timezone, logo_url FROM tenants WHERE tenant_id = :t"
            ),
            {"t": tenant_id},
        )
    ).mappings().first()

    scheme = settings.public_url_scheme
    return TenantConfigResponse(
        booking_url=f"{scheme}://{row['slug']}.{settings.public_booking_host}",
        admin_url=f"{scheme}://{row['slug']}.{settings.public_admin_host}",
        tenant_id=uuid.UUID(tenant_id),
        slug=row["slug"],
        display_name=row["trading_name"] or row["legal_name"],
        status=row["status"],
        currency=(row["default_currency"] or "USD").strip(),
        timezone=row["default_timezone"] or "America/New_York",
        logo_url=row["logo_url"],
    )


# ── GET /public/workspace-open ───────────────────────────────────────────────


@router.get("/workspace-open", summary="Is this workspace ready to take bookings?")
async def workspace_open(
    request: Request,
    slug: str | None = None,
    session: AsyncSession = Depends(get_session_untenanted),
) -> dict:
    """Whether the public booking site should present a storefront yet.

    A newly registered workspace has a branch and pricing but no fleet, so its
    public site would otherwise be a live, indexable shop with nothing to sell —
    which reads as a broken business rather than a new one.
    """
    candidate = (slug or extract_slug(request.headers.get("host", "")) or "").lower()
    if not candidate:
        raise HTTPException(status_code=400, detail="No workspace specified.")

    tenant_id = await tenant_id_for_slug(session, candidate)
    if not tenant_id:
        raise HTTPException(status_code=404, detail=f"No workspace found at '{candidate}'.")

    # "Ready to take bookings" has to mean the workspace is allowed to as well
    # as equipped to. This answered on fleet, branches and rates alone, so a
    # suspended company reported itself open for business.
    status_row = (
        await session.execute(
            text("SELECT status FROM tenants WHERE tenant_id = :t"), {"t": tenant_id}
        )
    ).first()
    if status_row and status_row[0] not in ("ACTIVE", "TRIAL"):
        return {
            "slug": candidate,
            "open": False,
            "vehicles": 0,
            "locations": 0,
            "reason": "This rental company is not currently taking bookings.",
        }

    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"), {"t": tenant_id}
    )
    row = (
        await session.execute(
            text(
                "SELECT (SELECT count(*) FROM vehicles WHERE deleted_at IS NULL)  AS vehicles,"
                "       (SELECT count(*) FROM locations WHERE is_active)          AS locations,"
                "       (SELECT count(*) FROM rate_codes WHERE status='ACTIVE')   AS rates"
            )
        )
    ).mappings().first() or {}

    ready = (row.get("vehicles", 0) > 0 and row.get("locations", 0) > 0
             and row.get("rates", 0) > 0)
    return {
        "slug": candidate,
        "open": ready,
        "vehicles": row.get("vehicles", 0),
        "locations": row.get("locations", 0),
        "reason": None if ready else "This company has not published its fleet yet.",
    }
