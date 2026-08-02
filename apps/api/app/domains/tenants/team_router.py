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


# Seniority for actions taken ON a member, as distinct from _GRANTABLE_ROLES
# which governs what may be handed out. Deactivation had no rank check at all,
# so a BRANCH_MANAGER — who is in ADMIN_ROLES and may therefore manage the team
# — could deactivate SYSTEM_ADMINs one at a time until only their own choice
# remained. The last-admin guard did not stop it: it only refuses when exactly
# one administrator is left, so with two present the first could always go.
_RANK: dict[str, int] = {
    "SUPER_ADMIN": 100,
    "SYSTEM_ADMIN": 90,
    "EXECUTIVE": 80,
    "REGIONAL_MANAGER": 70,
    "BRANCH_MANAGER": 60,
    "FLEET_MANAGER": 50,
    "FINANCE": 50,
    "FINANCE_ANALYST": 45,
    "CLAIMS_COORDINATOR": 45,
    "SENIOR_AGENT": 40,
    "MAINTENANCE_TECH": 30,
    "COUNTER_AGENT": 20,
    "READONLY_AUDITOR": 10,
}


def _assert_outranks(claims: UserClaims, target_role: str, verb: str) -> None:
    """Refuse an action on a member of equal or greater seniority."""
    actor = _RANK.get(claims.primary_role, 0)
    target = _RANK.get(target_role, 0)
    if actor <= target:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You cannot {verb} a {target_role.replace('_', ' ').lower()}.",
        )


async def _revoke_all_sessions(session: AsyncSession, user_id: str) -> None:
    """Sign a user out everywhere, immediately and durably.

    Two mechanisms, because neither alone is sufficient. The credential epoch
    lives in Postgres and invalidates every token ever issued to this user,
    including refresh tokens this process cannot enumerate — that is the
    authoritative kill. The JTI sweep makes it take effect now rather than
    after the epoch cache expires.

    Redis being unavailable must not make a deactivation silently fail, so the
    sweep is best-effort; the epoch has already been written to the database by
    then and is what actually holds.
    """
    # USER_SESSIONS_KEY is defined in the auth service, not core.redis, and is
    # imported from there so the two halves of revocation cannot drift onto
    # different key names.
    from app.core.redis import REVOKED_TOKENS_SET, get_session_redis
    from app.core.security import bump_epoch
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
                "LEFT JOIN plans p ON p.code = t.subscription_tier "
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
            400,
            "This is the workspace's last administrator. Give someone else the "
            "administrator role first.",
        )
    _assert_outranks(claims, target[0], "deactivate")

    await session.execute(
        text("UPDATE staff_users SET is_active = false, updated_at = now() "
             "WHERE user_id = :u AND tenant_id = :t"),
        {"u": str(user_id), "t": str(claims.tenant_id)},
    )

    # End their live sessions. Without this the flag flip was almost cosmetic:
    # get_current_user checks the signature, the revoked-JTI set and the
    # credential epoch — never is_active — so a deactivated person kept working
    # until their access token expired. On the counter PWA that is EIGHT HOURS,
    # i.e. someone dismissed at the start of a shift could still check cars out
    # for the rest of it. change_password and reset_password already do exactly
    # this; deactivation simply never did.
    await _revoke_all_sessions(session, str(user_id))

    log.info("staff_deactivated", tenant_id=str(claims.tenant_id), by=str(claims.user_id))
    return SimpleResult(ok=True, message="Team member deactivated and signed out.")


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


class RoleChange(BaseModel):
    role: str

    @field_validator("role")
    @classmethod
    def _known(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in INVITABLE_ROLES:
            raise ValueError("Unknown role.")
        return v


@router.patch("/members/{user_id}/role", response_model=SimpleResult,
              summary="Change a team member's role")
async def change_member_role(
    user_id: uuid.UUID,
    body: RoleChange,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> SimpleResult:
    """Give a team member a different role.

    This did not exist. Roles were fixed at account creation — the only two
    UPDATEs against staff_users in the whole application set email_verified_at
    and is_active — which made the last-admin guard's own advice impossible to
    follow: it refuses to deactivate the final administrator and tells you to
    promote someone else, and there was no way to promote anyone. A workspace
    whose sole admin left was frozen permanently and needed a DBA.

    Two rank rules, both needed. You cannot grant a role you could not invite,
    so nobody mints a peer or a superior. And you cannot act on someone who
    already outranks you, so a branch manager cannot demote the system
    administrator above them.
    """
    _require_team_admin(claims)
    if str(user_id) == str(claims.user_id):
        # Otherwise the only administrator can demote themselves and strand the
        # workspace — the exact failure the last-admin guard exists to prevent,
        # reached by a different route.
        raise HTTPException(400, "You cannot change your own role.")

    target = (
        await session.execute(
            text(
                "SELECT role, is_active FROM staff_users "
                " WHERE user_id = :u AND tenant_id = :t AND deleted_at IS NULL"
            ),
            {"u": str(user_id), "t": str(claims.tenant_id)},
        )
    ).first()
    if not target:
        raise HTTPException(404, "No such team member.")

    current_role = target[0]
    if current_role == body.role:
        return SimpleResult(ok=True, message=f"Already a {body.role}.")

    _assert_outranks(claims, current_role, "change the role of")
    _assert_may_grant(claims, body.role)

    if current_role in ("SYSTEM_ADMIN", "SUPER_ADMIN") and body.role not in (
        "SYSTEM_ADMIN", "SUPER_ADMIN",
    ):
        admins = (
            await session.execute(
                text(
                    "SELECT count(*) FROM staff_users "
                    " WHERE tenant_id = :t AND is_active AND deleted_at IS NULL "
                    "   AND role IN (\'SYSTEM_ADMIN\',\'SUPER_ADMIN\')"
                ),
                {"t": str(claims.tenant_id)},
            )
        ).scalar() or 0
        if admins <= 1:
            raise HTTPException(
                400,
                "This is the workspace's last administrator. Give someone else "
                "the administrator role first.",
            )

    await session.execute(
        text(
            "UPDATE staff_users SET role = :r, updated_at = now() "
            " WHERE user_id = :u AND tenant_id = :t"
        ),
        {"r": body.role, "u": str(user_id), "t": str(claims.tenant_id)},
    )

    # A role change alters what their existing token may do. Tokens carry the
    # role, so without this a demoted user keeps their old powers until the
    # token expires — up to eight hours on the counter.
    await _revoke_all_sessions(session, str(user_id))

    log.info(
        "staff_role_changed",
        tenant_id=str(claims.tenant_id),
        by=str(claims.user_id),
        from_role=current_role,
        to_role=body.role,
    )
    return SimpleResult(
        ok=True,
        message=f"Role changed to {body.role.replace('_', ' ').title()}. "
                "They will need to sign in again.",
    )


@router.post("/members/{user_id}/reactivate", response_model=SimpleResult,
             summary="Reactivate a deactivated team member")
async def reactivate_member(
    user_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> SimpleResult:
    """Restore access for someone previously deactivated.

    Deactivation was one-way through the API, so a mistaken click — or a
    seasonal worker returning — meant re-inviting them, which creates a second
    account and splits their history in two.
    """
    _require_team_admin(claims)
    target = (
        await session.execute(
            text(
                "SELECT role, is_active FROM staff_users "
                " WHERE user_id = :u AND tenant_id = :t AND deleted_at IS NULL"
            ),
            {"u": str(user_id), "t": str(claims.tenant_id)},
        )
    ).first()
    if not target:
        raise HTTPException(404, "No such team member.")
    if target[1]:
        return SimpleResult(ok=True, message="That member is already active.")

    _assert_outranks(claims, target[0], "reactivate")
    await assert_within_limit(session, claims.tenant_id, "staff")

    await session.execute(
        text(
            "UPDATE staff_users SET is_active = true, updated_at = now() "
            " WHERE user_id = :u AND tenant_id = :t"
        ),
        {"u": str(user_id), "t": str(claims.tenant_id)},
    )
    log.info("staff_reactivated", tenant_id=str(claims.tenant_id), by=str(claims.user_id))
    return SimpleResult(ok=True, message="Team member reactivated.")


# ── API keys ─────────────────────────────────────────────────────────────────
#
# Kept with team management because that is what this is: deciding who — and
# now what — may act on the workspace. An integration is a member of the team
# with a very small job.

class ApiKeyOut(BaseModel):
    key_id: uuid.UUID
    label: str
    key_prefix: str
    scopes: list[str]
    created_at: datetime
    expires_at: datetime | None = None
    revoked_at: datetime | None = None
    last_used_at: datetime | None = None
    last_used_ip: str | None = None


class ApiKeyCreated(ApiKeyOut):
    # Returned exactly once, by the create call, and by nothing else ever.
    key: str


class ApiKeyIn(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    # Default rather than optional: a credential with no end date is one nobody
    # ever revisits. Ninety days is long enough not to be a nuisance and short
    # enough that a forgotten key stops working.
    expires_in_days: int | None = Field(default=90, ge=1, le=3650)


@router.get("/api-keys", response_model=list[ApiKeyOut],
            summary="API keys for this workspace")
async def list_api_keys(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> list[ApiKeyOut]:
    _require_team_admin(claims)
    rows = (
        await session.execute(
            text(
                "SELECT key_id, label, key_prefix, scopes, created_at, expires_at, "
                "       revoked_at, last_used_at, last_used_ip "
                "  FROM api_keys WHERE tenant_id = :t ORDER BY created_at DESC"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().all()
    return [ApiKeyOut(**r) for r in rows]


@router.post("/api-keys", response_model=ApiKeyCreated,
             status_code=status.HTTP_201_CREATED,
             summary="Create an API key — shown once")
async def create_api_key(
    body: ApiKeyIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> ApiKeyCreated:
    """Mint a key. The secret is in this response and nowhere else, ever."""
    _require_team_admin(claims)
    from datetime import timedelta

    from app.core.api_key_auth import generate_key
    from app.domains.tenants.features import assert_feature

    # Gated like every other paid capability. Checked here rather than at the
    # router mount because the rest of team management is not a paid feature.
    await assert_feature(session, claims.tenant_id, "api_access")

    full, digest, prefix = generate_key()
    expires = (
        datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)
        if body.expires_in_days else None
    )
    key_id = str(uuid.uuid4())

    await session.execute(
        text(
            "INSERT INTO api_keys (key_id, tenant_id, label, key_hash, key_prefix, "
            "                      scopes, created_by, expires_at) "
            "VALUES (CAST(:k AS uuid), CAST(:t AS uuid), :l, :h, :p, "
            "        ARRAY['read']::text[], CAST(:u AS uuid), :e)"
        ),
        {"k": key_id, "t": str(claims.tenant_id), "l": body.label.strip(),
         "h": digest, "p": prefix, "u": str(claims.user_id), "e": expires},
    )
    await session.commit()

    log.warning("api_key_created", tenant_id=str(claims.tenant_id),
                key_id=key_id, label=body.label, by=str(claims.user_id))

    row = (
        await session.execute(
            text(
                "SELECT key_id, label, key_prefix, scopes, created_at, expires_at, "
                "       revoked_at, last_used_at, last_used_ip "
                "  FROM api_keys WHERE key_id = CAST(:k AS uuid) AND tenant_id = :t"
            ),
            {"k": key_id, "t": str(claims.tenant_id)},
        )
    ).mappings().first()
    return ApiKeyCreated(**row, key=full)


@router.delete("/api-keys/{key_id}", response_model=SimpleResult,
               summary="Revoke an API key")
async def revoke_api_key(
    key_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(get_current_user),
) -> SimpleResult:
    """Revoke, do not delete.

    The row is what tells you a key existed, what it could do and when it was
    last used. Deleting it erases the answer to "what did that integration have
    access to", which is the question asked after an incident.
    """
    res = await session.execute(
        text(
            "UPDATE api_keys SET revoked_at = now() "
            " WHERE key_id = :k AND tenant_id = :t AND revoked_at IS NULL "
            " RETURNING label"
        ),
        {"k": str(key_id), "t": str(claims.tenant_id)},
    )
    row = res.first()
    if not row:
        raise HTTPException(404, "No such key, or it is already revoked.")
    await session.commit()

    log.warning("api_key_revoked", tenant_id=str(claims.tenant_id),
                key_id=str(key_id), by=str(claims.user_id))
    return SimpleResult(ok=True, message=f"{row[0]} is revoked and stops working now.")
