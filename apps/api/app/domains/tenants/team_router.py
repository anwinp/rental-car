"""Team management for a workspace: invite, list, revoke, remove.

Closes the gap that made every self-registered workspace permanently
single-user. It also makes plan limits real: seats are the first thing a tier
actually constrains.

Invitations mirror email verification — hashed token, expiry, single use — with
one addition: the role is fixed at invite time by an existing administrator, so
accepting a link can never grant more access than was offered.
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session, get_session_untenanted
from app.core.mailer import send_email, wrap_html
from app.core.security import UserClaims, get_current_user, hash_password
from app.domains.tenants.limits import assert_within_limit

router = APIRouter()
log = structlog.get_logger()

INVITE_TTL = timedelta(days=7)

# Roles a workspace administrator may hand out. AGENT_SERVICE and API_PARTNER
# are machine identities and CUSTOMER is not staff, so none are invitable.
INVITABLE_ROLES = {
    "COUNTER_AGENT", "SENIOR_AGENT", "BRANCH_MANAGER", "REGIONAL_MANAGER",
    "FLEET_MANAGER", "MAINTENANCE_TECH", "CLAIMS_COORDINATOR", "FINANCE",
    "FINANCE_ANALYST", "EXECUTIVE", "READONLY_AUDITOR", "SYSTEM_ADMIN",
}

# Only these can manage the team. A counter agent must not be able to invite
# themselves a colleague, or promote one.
ADMIN_ROLES = {"SYSTEM_ADMIN", "SUPER_ADMIN", "BRANCH_MANAGER", "REGIONAL_MANAGER"}


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# What each administrator role may hand out. A role must never be able to mint
# an account that outranks it: BRANCH_MANAGER and REGIONAL_MANAGER are in
# ADMIN_ROLES, and SYSTEM_ADMIN is in INVITABLE_ROLES, so without this a branch
# manager could invite themselves an administrator and accept it from their own
# inbox. Verified live before this was added: HTTP 201.
#
# Only a SUPER_ADMIN may create another SUPER_ADMIN.
_GRANTABLE_ROLES: dict[str, set[str]] = {
    "SUPER_ADMIN":      INVITABLE_ROLES | {"SUPER_ADMIN"},
    "SYSTEM_ADMIN":     INVITABLE_ROLES,
    "REGIONAL_MANAGER": INVITABLE_ROLES - {"SYSTEM_ADMIN", "EXECUTIVE"},
    "BRANCH_MANAGER":   INVITABLE_ROLES - {"SYSTEM_ADMIN", "EXECUTIVE",
                                           "REGIONAL_MANAGER"},
}


def _require_team_admin(claims: UserClaims) -> UserClaims:
    if claims.primary_role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can manage the team.",
        )
    return claims


def _assert_may_grant(claims: UserClaims, role: str) -> None:
    """Refuse an invitation for a role the caller does not outrank."""
    allowed = _GRANTABLE_ROLES.get(claims.primary_role, set())
    if role not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"A {claims.primary_role.replace('_', ' ').lower()} cannot "
                f"invite someone as {role.replace('_', ' ').lower()}."
            ),
        )


# ── Schemas ──────────────────────────────────────────────────────────────────

class InviteRequest(BaseModel):
    email: EmailStr
    role: str
    first_name: str = Field(default="", max_length=60)
    last_name: str = Field(default="", max_length=60)

    @field_validator("role")
    @classmethod
    def _role(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in INVITABLE_ROLES:
            raise ValueError(f"'{v}' is not a role you can invite.")
        return v


class AcceptInviteRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=10, max_length=128)
    first_name: str = Field(default="", max_length=60)
    last_name: str = Field(default="", max_length=60)

    @field_validator("password")
    @classmethod
    def _strong(cls, v: str) -> str:
        if not any(c.isupper() for c in v) or not any(c.isdigit() for c in v):
            raise ValueError("Include at least one capital letter and one number.")
        return v


class Member(BaseModel):
    user_id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    role: str
    is_active: bool
    email_verified: bool


class Invitation(BaseModel):
    invitation_id: uuid.UUID
    email: str
    role: str
    expires_at: datetime
    created_at: datetime


class TeamResponse(BaseModel):
    members: list[Member]
    pending: list[Invitation]
    seats_used: int
    seats_limit: int | None = None   # null = unlimited


class SimpleResult(BaseModel):
    ok: bool
    message: str


# ── List ─────────────────────────────────────────────────────────────────────

@router.get("", response_model=TeamResponse, summary="Team members and pending invitations")
async def list_team(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> TeamResponse:
    # Every authenticated staff member could read this, so a counter agent
    # could enumerate every colleague's name, email address and role — and the
    # pending-invitation list alongside it. Confirmed live: a COUNTER_AGENT
    # session returned the full roster.
    #
    # The page this feeds is the team-management screen, which only these roles
    # can act on anyway; there is no read-only use for it below that line.
    _require_team_admin(claims)
    members = (
        await session.execute(
            text(
                "SELECT user_id, email, first_name, last_name, role, is_active, "
                "       email_verified_at "
                "FROM staff_users WHERE tenant_id = :t AND deleted_at IS NULL "
                "ORDER BY created_at"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().all()

    pending = (
        await session.execute(
            text(
                "SELECT invitation_id, email, role, expires_at, created_at "
                "FROM staff_invitations "
                "WHERE tenant_id = :t AND accepted_at IS NULL AND revoked_at IS NULL "
                "  AND expires_at > now() "
                "ORDER BY created_at DESC"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().all()

    limit = (
        await session.execute(
            text(
                "SELECT p.max_staff FROM tenants t "
                "LEFT JOIN plan_limits p ON p.tier = t.subscription_tier "
                "WHERE t.tenant_id = :t"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).first()

    return TeamResponse(
        members=[
            Member(
                user_id=m["user_id"], email=m["email"],
                first_name=m["first_name"], last_name=m["last_name"],
                role=m["role"], is_active=m["is_active"],
                email_verified=m["email_verified_at"] is not None,
            ) for m in members
        ],
        pending=[Invitation(**dict(p)) for p in pending],
        # Seats counts pending invitations too: an invitation is a promise of a
        # seat, and not counting it lets a tenant oversubscribe by inviting in
        # bulk and accepting later.
        seats_used=len(members) + len(pending),
        seats_limit=limit[0] if limit else None,
    )


# ── Invite ───────────────────────────────────────────────────────────────────

@router.post("/invite", response_model=SimpleResult, status_code=status.HTTP_201_CREATED,
             summary="Invite someone to the workspace")
async def invite(
    body: InviteRequest,
    request: Request,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> SimpleResult:
    _require_team_admin(claims)
    _assert_may_grant(claims, body.role)

    existing = (
        await session.execute(
            text(
                "SELECT 1 FROM staff_users "
                "WHERE tenant_id = :t AND lower(email) = lower(:e) AND deleted_at IS NULL"
            ),
            {"t": str(claims.tenant_id), "e": str(body.email)},
        )
    ).first()
    if existing:
        raise HTTPException(409, "That person is already on your team.")

    await assert_within_limit(session, claims.tenant_id, "staff")

    # Re-inviting supersedes any outstanding invitation for the same address,
    # so a forwarded older link stops working.
    await session.execute(
        text(
            "UPDATE staff_invitations SET revoked_at = now() "
            "WHERE tenant_id = :t AND lower(email) = lower(:e) "
            "  AND accepted_at IS NULL AND revoked_at IS NULL"
        ),
        {"t": str(claims.tenant_id), "e": str(body.email)},
    )

    token = secrets.token_urlsafe(32)
    await session.execute(
        text(
            """
            INSERT INTO staff_invitations (
                invitation_id, tenant_id, email, role, first_name, last_name,
                token_hash, invited_by, expires_at
            ) VALUES (:id, :t, :email, CAST(:role AS user_role), :first, :last,
                      :hash, :by, :expires)
            """
        ),
        {
            "id": str(uuid.uuid4()), "t": str(claims.tenant_id),
            "email": str(body.email), "role": body.role,
            "first": body.first_name, "last": body.last_name,
            "hash": _hash(token), "by": str(claims.user_id),
            "expires": datetime.now(timezone.utc) + INVITE_TTL,
        },
    )

    workspace = (
        await session.execute(
            text("SELECT legal_name FROM tenants WHERE tenant_id = :t"),
            {"t": str(claims.tenant_id)},
        )
    ).first()
    name = workspace[0] if workspace else "your team"

    origin = request.headers.get("origin") or f"http://{request.headers.get('host','localhost')}"
    link = f"{origin.rstrip('/')}/accept-invite?token={token}"

    await send_email(
        to_email=str(body.email),
        subject=f"You have been invited to {name} on RCM",
        html=wrap_html(
            f"Join {name}",
            f"<p>You have been invited to join <strong>{name}</strong> on RCM as "
            f"<strong>{body.role.replace('_', ' ').title()}</strong>.</p>"
            "<p>This invitation expires in 7 days.</p>",
            cta_text="Accept invitation",
            cta_url=link,
        ),
        kind="staff_invite",
    )

    log.info("staff_invited", tenant_id=str(claims.tenant_id), role=body.role,
             by=str(claims.user_id))
    return SimpleResult(ok=True, message=f"Invitation sent to {body.email}.")


@router.delete("/invitations/{invitation_id}", response_model=SimpleResult,
               summary="Revoke a pending invitation")
async def revoke_invite(
    invitation_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> SimpleResult:
    _require_team_admin(claims)
    res = await session.execute(
        text(
            "UPDATE staff_invitations SET revoked_at = now() "
            "WHERE invitation_id = :i AND tenant_id = :t AND accepted_at IS NULL"
        ),
        {"i": str(invitation_id), "t": str(claims.tenant_id)},
    )
    if not res.rowcount:
        raise HTTPException(404, "No such pending invitation.")
    return SimpleResult(ok=True, message="Invitation revoked.")


@router.post("/members/{user_id}/deactivate", response_model=SimpleResult,
             summary="Deactivate a team member")
async def deactivate_member(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> SimpleResult:
    _require_team_admin(claims)
    if str(user_id) == str(claims.user_id):
        raise HTTPException(400, "You cannot deactivate your own account.")

    # A workspace must always retain at least one active administrator, or it
    # becomes unmanageable and needs platform intervention to recover.
    admins = (
        await session.execute(
            text(
                "SELECT count(*) FROM staff_users "
                "WHERE tenant_id = :t AND is_active AND deleted_at IS NULL "
                "  AND role IN ('SYSTEM_ADMIN','SUPER_ADMIN')"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).scalar() or 0
    target = (
        await session.execute(
            text("SELECT role FROM staff_users WHERE user_id = :u AND tenant_id = :t"),
            {"u": str(user_id), "t": str(claims.tenant_id)},
        )
    ).first()
    if not target:
        raise HTTPException(404, "No such team member.")
    if target[0] in ("SYSTEM_ADMIN", "SUPER_ADMIN") and admins <= 1:
        raise HTTPException(
            400, "This is the workspace's last administrator. Promote someone else first."
        )

    await session.execute(
        text("UPDATE staff_users SET is_active = false, updated_at = now() "
             "WHERE user_id = :u AND tenant_id = :t"),
        {"u": str(user_id), "t": str(claims.tenant_id)},
    )
    log.info("staff_deactivated", tenant_id=str(claims.tenant_id), by=str(claims.user_id))
    return SimpleResult(ok=True, message="Team member deactivated.")


# ── Accept (public) ──────────────────────────────────────────────────────────

public_router = APIRouter()


@public_router.get("/invite-details", summary="What is this invitation for?")
async def invite_details(
    token: str,
    session: AsyncSession = Depends(get_session_untenanted),
) -> dict:
    """Let the accept page show who is inviting, before asking for a password."""
    row = (
        await session.execute(
            text(
                "SELECT i.email, i.role, i.first_name, i.last_name, i.expires_at, "
                "       i.accepted_at, i.revoked_at, t.legal_name, t.slug "
                "FROM staff_invitations i JOIN tenants t ON t.tenant_id = i.tenant_id "
                "WHERE i.token_hash = :h"
            ),
            {"h": _hash(token)},
        )
    ).mappings().first()

    if not row or row["revoked_at"]:
        raise HTTPException(404, "This invitation is no longer valid.")
    if row["accepted_at"]:
        raise HTTPException(409, "This invitation has already been used.")
    expires = row["expires_at"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(410, "This invitation has expired. Ask for a new one.")

    return {
        "email": row["email"],
        "role": row["role"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "workspace": row["legal_name"],
        "slug": row["slug"],
    }


@public_router.post("/accept-invite", response_model=SimpleResult,
                    summary="Accept an invitation and create the account")
async def accept_invite(
    body: AcceptInviteRequest,
    session: AsyncSession = Depends(get_session_untenanted),
) -> SimpleResult:
    row = (
        await session.execute(
            text(
                "SELECT invitation_id, tenant_id, email, role, first_name, last_name, "
                "       expires_at, accepted_at, revoked_at "
                "FROM staff_invitations WHERE token_hash = :h"
            ),
            {"h": _hash(body.token)},
        )
    ).mappings().first()

    if not row or row["revoked_at"]:
        raise HTTPException(404, "This invitation is no longer valid.")
    if row["accepted_at"]:
        raise HTTPException(409, "This invitation has already been used.")
    expires = row["expires_at"]
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < datetime.now(timezone.utc):
        raise HTTPException(410, "This invitation has expired. Ask for a new one.")

    tenant_id = row["tenant_id"]
    # Adopt the inviting workspace: every write below is RLS-checked against it,
    # and the token — not the caller — is what establishes which workspace.
    await session.execute(
        text("SELECT set_config('app.current_tenant_id', :t, true)"),
        {"t": str(tenant_id)},
    )

    await assert_within_limit(session, tenant_id, "staff")

    now = datetime.now(timezone.utc)
    await session.execute(
        text(
            """
            INSERT INTO staff_users (
                user_id, tenant_id, email, password_hash, first_name, last_name,
                role, is_active, location_ids, created_at, updated_at,
                is_mfa_enabled, failed_login_count, phone_verified, email_verified_at
            ) VALUES (
                :uid, :tid, :email, :pw, :first, :last,
                CAST(:role AS user_role), true, '{}', :now, :now,
                false, 0, false, :now
            )
            """
        ),
        {
            "uid": str(uuid.uuid4()), "tid": str(tenant_id),
            "email": str(row["email"]).lower(), "pw": hash_password(body.password),
            "first": body.first_name or row["first_name"] or "",
            "last": body.last_name or row["last_name"] or "",
            "role": row["role"], "now": now,
        },
    )
    await session.execute(
        text("UPDATE staff_invitations SET accepted_at = now() WHERE invitation_id = :i"),
        {"i": str(row["invitation_id"])},
    )

    log.info("staff_invite_accepted", tenant_id=str(tenant_id), role=row["role"])
    # Accepting proves the address, so the account starts verified — unlike
    # self-registration, where nobody has vouched for it.
    return SimpleResult(ok=True, message="Your account is ready. You can sign in now.")
