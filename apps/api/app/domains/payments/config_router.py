"""Where a tenant says how it takes money from renters.

Three things this file is careful about.

**Secrets are write-only.** A key that has been stored never comes back out over
the API — the response carries a four-character hint so the operator can tell
which key is in place, and nothing more. A PUT that omits a secret field leaves
the stored one alone, so saving an unrelated setting does not require retyping
credentials that are already correct.

**Saved is not live.** Credentials that have never successfully talked to the
processor cannot take real money. `verify` performs an actual authorisation and
immediately voids it; only that sets `verified_at`, and only that permits
`is_live`. The database enforces the same rule, because whether something may
charge a real card should not rest on one handler being right.

**Changing credentials un-verifies.** Editing a key clears `verified_at` and
drops the config out of live. Otherwise a tenant could verify with a working key,
then paste a broken one and keep the green tick.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.payments import providers

log = structlog.get_logger()
router = APIRouter()


# ── shapes ───────────────────────────────────────────────────────────────────

class DepositPolicy(BaseModel):
    """The tenant's own commercial policy, not the gateway's.

    Defaults to taking nothing: a deposit is a decision, and a system that holds
    money from a customer because a field defaulted to true is a system that
    will do it to someone who did not mean it.
    """
    enabled: bool = False
    # FLAT (minor units) or MULTIPLIER (× the rental total).
    basis: str = Field(default="FLAT", pattern="^(FLAT|MULTIPLIER)$")
    amount_cents: int = Field(default=0, ge=0)
    multiplier: float = Field(default=0, ge=0, le=10)
    # BOOKING or PICKUP.
    collect_at: str = Field(default="PICKUP", pattern="^(BOOKING|PICKUP)$")
    # Ride on the rental authorisation, or take a second one.
    separate_authorisation: bool = False
    # RETURN or INSPECTION.
    release_at: str = Field(default="RETURN", pattern="^(RETURN|INSPECTION)$")
    # Per vehicle class overrides: {class_id: amount_cents}
    per_class_cents: dict[str, int] = Field(default_factory=dict)


class ConfigIn(BaseModel):
    provider: str
    # Keyed by the registry's field names. Secret fields may be omitted to keep
    # what is already stored.
    values: dict[str, str] = Field(default_factory=dict)
    deposit_policy: DepositPolicy | None = None


class ConfigOut(BaseModel):
    configured: bool
    provider: str | None = None
    provider_label: str | None = None
    onboarding: str | None = None
    kind: str | None = None
    mode: str = "TEST"
    is_live: bool = False
    connected_account_id: str | None = None
    verified_at: datetime | None = None
    verify_error: str | None = None
    # {field_key: "••••1234"} — never the value.
    secret_hints: dict[str, str] = Field(default_factory=dict)
    settings: dict[str, Any] = Field(default_factory=dict)
    deposit_policy: dict[str, Any] = Field(default_factory=dict)
    capabilities: dict[str, Any] = Field(default_factory=dict)


class ProvidersOut(BaseModel):
    providers: list[dict[str, Any]]
    secrets_available: bool


class GoLiveIn(BaseModel):
    live: bool


# ── helpers ──────────────────────────────────────────────────────────────────

_SELECT = (
    "SELECT provider, onboarding, connected_account_id, secrets_enc, "
    "       secret_hints, settings, mode, is_live, verified_at, verify_error, "
    "       deposit_policy "
    "  FROM tenant_payment_config WHERE tenant_id = :t"
)


async def _row(session: AsyncSession, tenant_id: str) -> dict | None:
    return (
        await session.execute(text(_SELECT), {"t": tenant_id})
    ).mappings().first()


def _to_out(row: dict | None) -> ConfigOut:
    if not row:
        return ConfigOut(configured=False)
    p = providers.get(row["provider"])
    return ConfigOut(
        configured=True,
        provider=row["provider"],
        provider_label=p.label if p else row["provider"],
        onboarding=row["onboarding"],
        kind=p.kind if p else None,
        mode=row["mode"],
        is_live=row["is_live"],
        connected_account_id=row["connected_account_id"],
        verified_at=row["verified_at"],
        verify_error=row["verify_error"],
        secret_hints=row["secret_hints"] or {},
        settings=row["settings"] or {},
        deposit_policy=row["deposit_policy"] or {},
        capabilities=providers.describe(p)["capabilities"] if p else {},
    )


def _derive_mode(provider_key: str, values: dict[str, str], existing: str) -> str:
    """TEST or LIVE, read off the credentials where the provider makes it visible.

    Derived rather than asked, so the badge cannot disagree with what is
    actually configured — someone demonstrating a booking in test mode should
    never be able to believe money moved.
    """
    key = values.get("secret_key") or values.get("api_key") or ""
    if key.startswith("sk_test_"):
        return "TEST"
    if key.startswith("sk_live_"):
        return "LIVE"
    return existing


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/providers", response_model=ProvidersOut,
            summary="Payment providers this workspace can use")
async def list_providers(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ProvidersOut:
    from app.core.secrets_box import is_configured

    # There is no country on `tenants`; where a workspace operates is a
    # property of its locations. Take the most common one — a company with
    # branches in two countries still has a home market, and offering it a
    # provider that cannot serve any of its branches would be the actual bug.
    country = (
        await session.execute(
            text(
                "SELECT country_code FROM locations "
                " WHERE tenant_id = :t AND deleted_at IS NULL "
                "   AND country_code IS NOT NULL "
                " GROUP BY country_code ORDER BY count(*) DESC LIMIT 1"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).scalar_one_or_none()

    return ProvidersOut(
        providers=[providers.describe(p) for p in providers.for_country(country)],
        # Without an encryption key we cannot store a credential at all. Say so
        # rather than letting a tenant fill in a form that will fail to save.
        secrets_available=is_configured(),
    )


@router.get("", response_model=ConfigOut, summary="Current payment configuration")
async def get_config(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ConfigOut:
    return _to_out(await _row(session, str(claims.tenant_id)))


@router.put("", response_model=ConfigOut, summary="Save payment configuration")
async def put_config(
    body: ConfigIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ConfigOut:
    from app.core.secrets_box import encrypt, hint, is_configured

    provider = providers.get(body.provider)
    if not provider:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No such payment provider.")
    if not provider.available:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            provider.unavailable_reason or "That provider is not available yet.",
        )
    if provider.onboarding == "managed":
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"{provider.label} is set up by connecting your account, not by "
            "entering credentials.",
        )

    existing = await _row(session, str(claims.tenant_id))
    secrets: dict[str, str] = dict((existing or {}).get("secrets_enc") or {})
    hints: dict[str, str] = dict((existing or {}).get("secret_hints") or {})
    settings: dict[str, Any] = dict((existing or {}).get("settings") or {})

    secret_changed = False
    for f in provider.fields:
        supplied = (body.values.get(f.key) or "").strip()
        if f.secret:
            if not supplied:
                continue                      # omitted → keep what is stored
            if not is_configured():
                raise HTTPException(
                    status.HTTP_503_SERVICE_UNAVAILABLE,
                    "Payment credentials cannot be stored: the server has no "
                    "encryption key configured.",
                )
            secrets[f.key] = encrypt(supplied, name=f"tenant_payment.{f.key}")
            hints[f.key] = hint(supplied)
            secret_changed = True
        else:
            settings[f.key] = supplied

    # Required fields must end up present, whether from this request or already
    # stored — otherwise a partial save leaves a config that cannot transact.
    for f in provider.fields:
        if not f.required:
            continue
        present = (f.key in secrets) if f.secret else bool(settings.get(f.key))
        if not present:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY, f"{f.label} is required.")

    mode = _derive_mode(provider.key, body.values, (existing or {}).get("mode") or "TEST")
    policy = (
        body.deposit_policy.model_dump()
        if body.deposit_policy is not None
        else ((existing or {}).get("deposit_policy") or {})
    )

    # Changing a credential invalidates the verification it was not part of.
    keep_verified = bool(existing) and not secret_changed
    await session.execute(
        text(
            """
            INSERT INTO tenant_payment_config
                (tenant_id, provider, onboarding, secrets_enc, secret_hints,
                 settings, mode, deposit_policy, is_live, verified_at,
                 verify_error, updated_by, updated_at)
            VALUES
                (:t, :provider, 'credentials', CAST(:secrets AS jsonb),
                 CAST(:hints AS jsonb), CAST(:settings AS jsonb), :mode,
                 CAST(:policy AS jsonb), false, NULL, NULL, :by, now())
            ON CONFLICT (tenant_id) DO UPDATE SET
                provider    = EXCLUDED.provider,
                onboarding  = 'credentials',
                secrets_enc = EXCLUDED.secrets_enc,
                secret_hints= EXCLUDED.secret_hints,
                settings    = EXCLUDED.settings,
                mode        = EXCLUDED.mode,
                deposit_policy = EXCLUDED.deposit_policy,
                connected_account_id = NULL,
                is_live     = CASE WHEN :keep THEN tenant_payment_config.is_live
                                   ELSE false END,
                verified_at = CASE WHEN :keep THEN tenant_payment_config.verified_at
                                   ELSE NULL END,
                verify_error = NULL,
                updated_by  = EXCLUDED.updated_by,
                updated_at  = now()
            """
        ),
        {
            "t": str(claims.tenant_id), "provider": provider.key,
            "secrets": _json(secrets), "hints": _json(hints),
            "settings": _json(settings), "mode": mode,
            "policy": _json(policy), "keep": keep_verified,
            "by": str(claims.user_id),
        },
    )
    await session.commit()
    log.info("tenant_payment_config_saved", tenant_id=str(claims.tenant_id),
             provider=provider.key, mode=mode, secret_changed=secret_changed)
    return _to_out(await _row(session, str(claims.tenant_id)))


@router.post("/verify", response_model=ConfigOut,
             summary="Check the credentials actually work")
async def verify_config(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ConfigOut:
    """Prove the configuration can talk to the processor, and record it.

    This is the gate on going live. It makes a real call against the tenant's
    own credentials rather than checking that fields are non-empty, because a
    well-formed key for the wrong account looks identical to a correct one until
    somebody tries to charge with it.
    """
    row = await _row(session, str(claims.tenant_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing configured yet.")

    from app.domains.payments.verification import verify_tenant_payments

    ok, detail = await verify_tenant_payments(session, str(claims.tenant_id))

    await session.execute(
        text(
            "UPDATE tenant_payment_config "
            "   SET verified_at = CASE WHEN :ok THEN now() ELSE NULL END, "
            "       verify_error = CASE WHEN :ok THEN NULL ELSE :detail END, "
            "       is_live = CASE WHEN :ok THEN is_live ELSE false END, "
            "       updated_at = now() "
            " WHERE tenant_id = :t"
        ),
        {"t": str(claims.tenant_id), "ok": ok, "detail": detail},
    )
    await session.commit()
    log.info("tenant_payment_verify", tenant_id=str(claims.tenant_id), ok=ok)
    return _to_out(await _row(session, str(claims.tenant_id)))


@router.post("/live", response_model=ConfigOut, summary="Start or stop taking payments")
async def set_live(
    body: GoLiveIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ConfigOut:
    row = await _row(session, str(claims.tenant_id))
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Nothing configured yet.")
    if body.live and not row["verified_at"]:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Check the connection first — these credentials have not been "
            "shown to work.",
        )
    await session.execute(
        text("UPDATE tenant_payment_config SET is_live = :live, updated_at = now() "
             " WHERE tenant_id = :t"),
        {"t": str(claims.tenant_id), "live": body.live},
    )
    await session.commit()
    log.warning("tenant_payment_live_changed", tenant_id=str(claims.tenant_id),
                live=body.live, by=str(claims.user_id))
    return _to_out(await _row(session, str(claims.tenant_id)))


@router.delete("", response_model=ConfigOut, summary="Remove payment configuration")
async def delete_config(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ConfigOut:
    await session.execute(
        text("DELETE FROM tenant_payment_config WHERE tenant_id = :t"),
        {"t": str(claims.tenant_id)},
    )
    await session.commit()
    log.warning("tenant_payment_config_removed", tenant_id=str(claims.tenant_id),
                by=str(claims.user_id))
    return ConfigOut(configured=False)


def _json(value: Any) -> str:
    import json
    return json.dumps(value)
