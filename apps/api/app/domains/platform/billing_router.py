"""Where the platform's own Stripe credentials are configured.

Distinct from every other router here because what it holds is different in
kind: a live secret key can move money out of the company's account. The
protections are therefore stacked rather than singular, and each one is here
because it fails differently from the others.

  1. **Platform-operator only**, via require_platform_admin, which re-reads the
     database on every request. A revoked operator loses this immediately.

  2. **Re-authentication on every write.** Holding a session is not enough to
     change a payment credential — the password is required again, in the same
     request. A borrowed laptop or a stolen cookie stops here, which is the one
     attack a session-based check cannot see.

  3. **Write-only secrets.** No endpoint returns a stored key, in any form,
     ever. The read endpoint returns the last four characters and nothing else.
     There is no "reveal" and no "copy" — an operator who needs the key has it
     in Stripe's own dashboard.

  4. **Encrypted at rest**, keyed from the process environment. A database dump
     is not a working credential.

  5. **Fail closed** when no encryption key is configured: the write is refused
     rather than quietly storing plaintext.

  6. **Nothing is logged but a hint.** No exception handler, no structlog call
     and no error message here may carry a key. Stripe's own errors are
     truncated for the same reason.

  7. **Live keys need an explicit acknowledgement.** Pasting an sk_live_ key is
     the moment real money becomes reachable, and it should take a deliberate
     act rather than a paste.
"""
from __future__ import annotations

from datetime import datetime, timezone

import structlog
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session_untenanted
from app.core.platform_security import PlatformClaims
from app.core.ratelimit import enforce_limit
from app.core.secrets_box import SecretsNotConfigured, encrypt, hint, is_configured
from app.core.security import verify_password
from app.domains.platform.router import require_platform_admin

log = structlog.get_logger()

router = APIRouter(prefix="/platform/billing", tags=["platform-billing"])

# Stripe's documented prefixes. Checked so a mistyped or wrong-field paste is
# caught here rather than at the first charge attempt — and so `mode` can be
# derived from the key instead of trusted from a form.
_SECRET_PREFIXES = ("sk_test_", "sk_live_", "rk_test_", "rk_live_")
_PUBLISHABLE_PREFIXES = ("pk_test_", "pk_live_")
_WEBHOOK_PREFIX = "whsec_"


class BillingConfigOut(BaseModel):
    """What the console may see. Note what is missing: any secret, in any form."""
    publishable_key: str | None = None
    secret_key_hint: str | None = None
    webhook_secret_hint: str | None = None
    mode: str = "TEST"
    is_enabled: bool = False
    secret_key_set: bool = False
    webhook_secret_set: bool = False
    last_verified_at: datetime | None = None
    last_verify_error: str | None = None
    updated_at: datetime | None = None
    # False when PLATFORM_SECRETS_KEY is absent. The UI explains rather than
    # letting a save fail with something unhelpful.
    encryption_ready: bool = True


class BillingConfigIn(BaseModel):
    # Re-authentication. Named for what it is, so nobody mistakes it for the
    # thing being configured.
    current_password: str

    publishable_key: str | None = None
    secret_key: str | None = None
    webhook_secret: str | None = None
    # Required when the secret key is a live one. A deliberate act, not a paste.
    acknowledge_live: bool = False

    @field_validator("publishable_key")
    @classmethod
    def _pk(cls, v: str | None) -> str | None:
        v = (v or "").strip() or None
        if v and not v.startswith(_PUBLISHABLE_PREFIXES):
            raise ValueError("A publishable key starts with pk_test_ or pk_live_.")
        return v

    @field_validator("secret_key")
    @classmethod
    def _sk(cls, v: str | None) -> str | None:
        v = (v or "").strip() or None
        if v and not v.startswith(_SECRET_PREFIXES):
            # Deliberately does not echo what was supplied. If somebody pasted
            # a real key into the wrong field, repeating it into a validation
            # message puts it in logs, browser history and screenshots.
            raise ValueError(
                "A secret key starts with sk_test_, sk_live_, rk_test_ or rk_live_."
            )
        return v

    @field_validator("webhook_secret")
    @classmethod
    def _whsec(cls, v: str | None) -> str | None:
        v = (v or "").strip() or None
        if v and not v.startswith(_WEBHOOK_PREFIX):
            raise ValueError("A webhook signing secret starts with whsec_.")
        return v


class EnableIn(BaseModel):
    current_password: str
    is_enabled: bool


class VerifyIn(BaseModel):
    current_password: str


async def _reauthenticate(
    session: AsyncSession, claims: PlatformClaims, password: str
) -> None:
    """Prove the person at the keyboard is the account holder, now.

    Separate from the session check on purpose. A session says a password was
    correct at some point in the last eight hours; this says it is correct at
    the moment a payment credential changes.
    """
    row = (
        await session.execute(
            text(
                "SELECT password_hash FROM platform_admins "
                " WHERE admin_id = :a AND is_active AND deleted_at IS NULL"
            ),
            {"a": str(claims.admin_id)},
        )
    ).mappings().first()

    ok = False
    if row:
        try:
            ok = verify_password(password, row["password_hash"])
        except Exception:  # noqa: BLE001 — an unparseable hash is not a 500
            ok = False
    if not ok:
        log.warning("platform_billing_reauth_failed", admin_id=str(claims.admin_id))
        raise HTTPException(status_code=400, detail="That password is not right.")


async def _read(session: AsyncSession) -> dict:
    row = (
        await session.execute(
            text(
                "SELECT publishable_key, secret_key_hint, webhook_secret_hint, "
                "       mode, is_enabled, last_verified_at, last_verify_error, "
                "       updated_at, "
                "       secret_key_enc IS NOT NULL     AS secret_key_set, "
                "       webhook_secret_enc IS NOT NULL AS webhook_secret_set "
                "  FROM platform_billing_config WHERE id = 1"
            )
        )
    ).mappings().first()
    # The ciphertext columns are deliberately absent from that SELECT rather
    # than fetched and filtered afterwards. A secret that is never loaded
    # cannot be leaked by a later change to this function.
    return dict(row or {})


@router.get("/config", response_model=BillingConfigOut)
async def get_billing_config(
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> BillingConfigOut:
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    return BillingConfigOut(**_scrub(await _read(session)), encryption_ready=is_configured())


def _scrub(row: dict) -> dict:
    """Belt and braces: drop anything ending in _enc before it can be returned."""
    return {k: v for k, v in row.items() if not k.endswith("_enc")}


@router.put("/config", response_model=BillingConfigOut)
async def set_billing_config(
    payload: BillingConfigIn,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> BillingConfigOut:
    """Store credentials. Requires the password again, in this request."""
    await enforce_limit(
        request, bucket="platform-billing", limit=10, window_seconds=900,
        subject=str(claims.admin_id),
        message="Too many attempts. Try again shortly.",
    )
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    await _reauthenticate(session, claims, payload.current_password)

    if payload.secret_key and not is_configured():
        # Refuse rather than store plaintext. The message says how to fix it,
        # because a locked door with no instructions is just a locked door.
        raise HTTPException(
            status_code=503,
            detail=(
                "PLATFORM_SECRETS_KEY is not configured on the server, so a "
                "secret key cannot be stored safely. Set it and restart the API."
            ),
        )

    live = bool(payload.secret_key and payload.secret_key.startswith(("sk_live_", "rk_live_")))
    if live and not payload.acknowledge_live:
        raise HTTPException(
            status_code=400,
            detail=(
                "That is a live key — saving it makes real charges possible. "
                "Confirm you intend to use live mode."
            ),
        )

    sets: list[str] = []
    params: dict = {"by": str(claims.admin_id)}

    if payload.publishable_key is not None:
        sets.append("publishable_key = :pk")
        params["pk"] = payload.publishable_key

    if payload.secret_key:
        try:
            params["sk"] = encrypt(payload.secret_key, name="stripe_secret_key")
        except SecretsNotConfigured as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        params["skh"] = hint(payload.secret_key)
        params["mode"] = "LIVE" if live else "TEST"
        sets += ["secret_key_enc = :sk", "secret_key_hint = :skh", "mode = :mode"]
        # Credentials changed, so any previous verification is stale.
        sets += ["last_verified_at = NULL", "last_verify_error = NULL"]

    if payload.webhook_secret:
        try:
            params["wh"] = encrypt(payload.webhook_secret, name="stripe_webhook_secret")
        except SecretsNotConfigured as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        params["whh"] = hint(payload.webhook_secret)
        sets += ["webhook_secret_enc = :wh", "webhook_secret_hint = :whh"]

    if not sets:
        raise HTTPException(status_code=400, detail="Nothing to change.")

    sets += ["updated_at = now()", "updated_by = CAST(:by AS uuid)"]
    await session.execute(
        text(f"UPDATE platform_billing_config SET {', '.join(sets)} WHERE id = 1"),
        params,
    )
    await session.commit()

    # Hints only. Nothing in this log line could be replayed against Stripe.
    log.warning(
        "platform_billing_config_updated",
        by=str(claims.admin_id), by_email=claims.email,
        changed=[s.split(" =")[0] for s in sets if not s.startswith("updated")],
        mode=params.get("mode"),
        secret_hint=params.get("skh"), webhook_hint=params.get("whh"),
    )
    return BillingConfigOut(**_scrub(await _read(session)), encryption_ready=True)


@router.post("/config/verify", response_model=BillingConfigOut)
async def verify_billing_config(
    payload: VerifyIn,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> BillingConfigOut:
    """Ask Stripe whether the stored key actually works.

    "Saved" is not "working". A key with the right shape can still be revoked,
    from the wrong account, or restricted to scopes that cannot create a
    subscription — and the first anyone would know is a customer's failed
    checkout. This decrypts server-side, calls Stripe, and records the outcome.
    The key does not appear in the request or the response.
    """
    await enforce_limit(
        request, bucket="platform-billing-verify", limit=20, window_seconds=900,
        subject=str(claims.admin_id), message="Too many attempts. Try again shortly.",
    )
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    await _reauthenticate(session, claims, payload.current_password)

    row = (
        await session.execute(
            text("SELECT secret_key_enc FROM platform_billing_config WHERE id = 1")
        )
    ).mappings().first()
    if not row or not row["secret_key_enc"]:
        raise HTTPException(status_code=400, detail="No secret key is stored yet.")

    from app.core.secrets_box import decrypt

    try:
        key = decrypt(row["secret_key_enc"], name="stripe_secret_key")
    except Exception as exc:  # noqa: BLE001
        # Almost always a rotated PLATFORM_SECRETS_KEY. Say that, rather than
        # leaving somebody staring at a cipher error.
        raise HTTPException(
            status_code=500,
            detail=(
                "The stored key could not be decrypted. If PLATFORM_SECRETS_KEY "
                "changed, the credentials must be entered again."
            ),
        ) from exc

    error: str | None = None
    try:
        import httpx

        async with httpx.AsyncClient(timeout=15.0) as client:
            # A read-only call, so verification cannot itself move money. Basic
            # auth with the key as username is Stripe's documented scheme.
            res = await client.get(
                "https://api.stripe.com/v1/balance", auth=(key, ""),
            )
        if res.status_code == 401:
            error = "Stripe rejected the key."
        elif res.status_code == 403:
            error = "The key is valid but lacks permission to read the balance."
        elif res.status_code >= 400:
            # Truncated, and Stripe echoes no key material here — but the bound
            # is what stops an unexpected upstream response becoming a log of
            # something sensitive.
            error = f"Stripe returned {res.status_code}: {res.text[:120]}"
    except Exception:  # noqa: BLE001 — never let an exception carry the key
        error = "Could not reach Stripe."
    finally:
        del key

    await session.execute(
        text(
            "UPDATE platform_billing_config "
            "   SET last_verified_at = :t, last_verify_error = :e, updated_at = now() "
            " WHERE id = 1"
        ),
        {"t": None if error else datetime.now(timezone.utc), "e": error},
    )
    await session.commit()

    log.info("platform_billing_verified", by=str(claims.admin_id), ok=not error,
             error=error)
    return BillingConfigOut(**_scrub(await _read(session)), encryption_ready=is_configured())


@router.post("/config/enable", response_model=BillingConfigOut)
async def set_billing_enabled(
    payload: EnableIn,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> BillingConfigOut:
    """Switch billing on or off. Separate from saving keys, on purpose.

    Pasting a key and charging customers are different decisions and should
    take different clicks. Switching on is refused until a verification has
    actually succeeded — otherwise "enabled" means "we hope".
    """
    await enforce_limit(
        request, bucket="platform-billing", limit=10, window_seconds=900,
        subject=str(claims.admin_id), message="Too many attempts. Try again shortly.",
    )
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    await _reauthenticate(session, claims, payload.current_password)

    current = await _read(session)
    if payload.is_enabled:
        if not current.get("secret_key_set") or not current.get("webhook_secret_set"):
            raise HTTPException(
                status_code=400,
                detail="Both the secret key and the webhook signing secret are needed first.",
            )
        if not current.get("last_verified_at"):
            raise HTTPException(
                status_code=400,
                detail="Verify the credentials against Stripe before switching billing on.",
            )

    await session.execute(
        text(
            "UPDATE platform_billing_config "
            "   SET is_enabled = :e, updated_at = now(), updated_by = CAST(:by AS uuid) "
            " WHERE id = 1"
        ),
        {"e": payload.is_enabled, "by": str(claims.admin_id)},
    )
    await session.commit()

    log.warning("platform_billing_enabled" if payload.is_enabled else "platform_billing_disabled",
                by=str(claims.admin_id), by_email=claims.email,
                mode=current.get("mode"))
    return BillingConfigOut(**_scrub(await _read(session)), encryption_ready=is_configured())


@router.delete("/config", response_model=BillingConfigOut)
async def clear_billing_config(
    payload: VerifyIn,
    request: Request,
    session: AsyncSession = Depends(get_session_untenanted),
    claims: PlatformClaims = Depends(require_platform_admin),
) -> BillingConfigOut:
    """Remove the stored credentials, and switch billing off with them.

    Leaving is_enabled true with no key would be a configuration that claims to
    charge customers and cannot.
    """
    await enforce_limit(
        request, bucket="platform-billing", limit=10, window_seconds=900,
        subject=str(claims.admin_id), message="Too many attempts. Try again shortly.",
    )
    await session.execute(text("SELECT set_config('app.current_tenant_id', '', true)"))
    await _reauthenticate(session, claims, payload.current_password)

    await session.execute(
        text(
            "UPDATE platform_billing_config "
            "   SET secret_key_enc = NULL, secret_key_hint = NULL, "
            "       webhook_secret_enc = NULL, webhook_secret_hint = NULL, "
            "       publishable_key = NULL, is_enabled = false, "
            "       last_verified_at = NULL, last_verify_error = NULL, "
            "       mode = 'TEST', updated_at = now(), updated_by = CAST(:by AS uuid) "
            " WHERE id = 1"
        ),
        {"by": str(claims.admin_id)},
    )
    await session.commit()

    log.warning("platform_billing_config_cleared", by=str(claims.admin_id),
                by_email=claims.email)
    return BillingConfigOut(**_scrub(await _read(session)), encryption_ready=is_configured())
