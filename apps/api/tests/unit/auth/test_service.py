"""
Unit tests for AuthService.

All external dependencies (DB session, Redis) are mocked.
Tests verify business logic in isolation.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import AccountLockedError, InvalidCredentialsError


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_user(
    user_id: Optional[str] = None,
    email: str = "agent@example.com",
    tenant_id: Optional[str] = None,
    hashed_password: str = "",
    is_active: bool = True,
    failed_login_count: int = 0,
    locked_until: Optional[datetime] = None,
    role: str = "COUNTER_AGENT",
    mfa_secret: Optional[str] = None,
    is_mfa_enabled: bool = False,
    location_ids: Optional[list] = None,
) -> MagicMock:
    user = MagicMock()
    user.user_id = user_id or str(uuid.uuid4())
    user.email = email
    user.tenant_id = tenant_id or str(uuid.uuid4())
    user.hashed_password = hashed_password
    user.is_active = is_active
    user.failed_login_count = failed_login_count
    user.locked_until = locked_until
    user.role = role
    user.mfa_secret = mfa_secret
    user.is_mfa_enabled = is_mfa_enabled
    user.location_ids = location_ids or []
    return user


# ── test_login_success ─────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_success():
    """
    Correct credentials → tokens returned, session stored in Redis.
    """
    user = _make_user(hashed_password="hashed")
    mock_session = AsyncMock()
    mock_repo = AsyncMock()
    mock_repo.get_by_email_and_tenant.return_value = user
    mock_repo.reset_login_failures = AsyncMock()
    mock_repo.update_last_login = AsyncMock()

    mock_redis = AsyncMock()
    mock_redis.setex = AsyncMock()
    mock_redis.sadd = AsyncMock()

    mock_response = MagicMock()

    with (
        patch("app.domains.auth.service.AuthRepository", return_value=mock_repo),
        patch("app.domains.auth.service.get_session_redis", return_value=mock_redis),
        patch("app.domains.auth.service.verify_password", return_value=True),
        patch("app.domains.auth.service.create_access_token", return_value="access_tok"),
        patch("app.domains.auth.service.create_refresh_token", return_value="refresh_tok"),
        patch("app.domains.auth.service.set_auth_cookies"),
        patch("app.domains.auth.service.hash_password", return_value="new_hash"),
    ):
        from app.domains.auth.service import AuthService
        service = AuthService(mock_session)

        access_token, refresh_token = await service.login(
            email="agent@example.com",
            password="CorrectPassword1!",
            tenant_id=user.tenant_id,
            ip="127.0.0.1",
            app_context="web",
            response=mock_response,
        )

    assert access_token == "access_tok"
    assert refresh_token == "refresh_tok"
    # Session stored in Redis
    mock_redis.setex.assert_called()
    # Login failures reset
    mock_repo.reset_login_failures.assert_called_once()


# ── test_login_wrong_password ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_wrong_password():
    """
    Wrong password → increments failed_login_count, raises InvalidCredentialsError.
    """
    user = _make_user(hashed_password="hashed", failed_login_count=0)
    mock_session = AsyncMock()
    mock_repo = AsyncMock()
    mock_repo.get_by_email_and_tenant.return_value = user
    mock_repo.increment_failed_login = AsyncMock()

    mock_redis = AsyncMock()

    with (
        patch("app.domains.auth.service.AuthRepository", return_value=mock_repo),
        patch("app.domains.auth.service.get_session_redis", return_value=mock_redis),
        patch("app.domains.auth.service.verify_password", return_value=False),
    ):
        from app.domains.auth.service import AuthService
        service = AuthService(mock_session)

        with pytest.raises(InvalidCredentialsError):
            await service.login(
                email="agent@example.com",
                password="WrongPass1!",
                tenant_id=user.tenant_id,
                ip="127.0.0.1",
                app_context="web",
                response=MagicMock(),
            )

    mock_repo.increment_failed_login.assert_called_once_with(user.user_id)


# ── test_login_lockout ────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_lockout():
    """
    5 consecutive failures → account locked, AccountLockedError raised.
    """
    # User is at 4 failures (one more will trigger lockout)
    user = _make_user(hashed_password="hashed", failed_login_count=4)
    mock_session = AsyncMock()
    mock_repo = AsyncMock()
    mock_repo.get_by_email_and_tenant.return_value = user
    mock_repo.increment_failed_login = AsyncMock()
    mock_repo.lock_account = AsyncMock()

    with (
        patch("app.domains.auth.service.AuthRepository", return_value=mock_repo),
        patch("app.domains.auth.service.get_session_redis", return_value=AsyncMock()),
        patch("app.domains.auth.service.verify_password", return_value=False),
    ):
        from app.domains.auth.service import AuthService
        service = AuthService(mock_session)

        with pytest.raises(AccountLockedError):
            await service.login(
                email="agent@example.com",
                password="WrongPass1!",
                tenant_id=user.tenant_id,
                ip="127.0.0.1",
                app_context="web",
                response=MagicMock(),
            )

    # Account should be locked
    mock_repo.lock_account.assert_called_once()
    locked_until_arg = mock_repo.lock_account.call_args[0][1]
    # Should be locked for approximately 15 minutes
    assert locked_until_arg > datetime.now(timezone.utc) + timedelta(minutes=14)


# ── test_login_already_locked ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_login_already_locked():
    """
    User with locked_until > now → AccountLockedError raised without checking password.
    """
    locked_until = datetime.now(timezone.utc) + timedelta(minutes=10)
    user = _make_user(hashed_password="hashed", locked_until=locked_until)
    mock_session = AsyncMock()
    mock_repo = AsyncMock()
    mock_repo.get_by_email_and_tenant.return_value = user

    with (
        patch("app.domains.auth.service.AuthRepository", return_value=mock_repo),
        patch("app.domains.auth.service.get_session_redis", return_value=AsyncMock()),
        patch("app.domains.auth.service.verify_password") as mock_verify,
    ):
        from app.domains.auth.service import AuthService
        service = AuthService(mock_session)

        with pytest.raises(AccountLockedError):
            await service.login(
                email="agent@example.com",
                password="AnyPassword1!",
                tenant_id=user.tenant_id,
                ip="127.0.0.1",
                app_context="web",
                response=MagicMock(),
            )

    # verify_password should NOT be called for a locked account
    mock_verify.assert_not_called()


# ── test_logout_revokes_token ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_logout_revokes_token():
    """
    Logout → JTI added to revoked set and session key deleted.
    """
    jti = str(uuid.uuid4())
    mock_session = AsyncMock()
    mock_redis = AsyncMock()
    mock_redis.sadd = AsyncMock()
    mock_redis.delete = AsyncMock()
    mock_response = MagicMock()

    with patch("app.domains.auth.service.get_session_redis", return_value=mock_redis):
        from app.domains.auth.service import AuthService
        service = AuthService(mock_session)
        await service.logout(jti, None, mock_response)

    # JTI must be in revoked set
    mock_redis.sadd.assert_called()
    revoke_call_args = [call.args for call in mock_redis.sadd.call_args_list]
    assert any(jti in args for args in revoke_call_args)

    # Session key must be deleted
    mock_redis.delete.assert_called()
    delete_call_args = [call.args for call in mock_redis.delete.call_args_list]
    assert any(jti in str(args) for args in delete_call_args)

    # Cookies cleared
    mock_response.delete_cookie.assert_called()


# ── test_refresh_rotates_tokens ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_refresh_rotates_tokens():
    """
    Refresh → old JTI revoked, new tokens issued.
    """
    import time
    old_jti = str(uuid.uuid4())
    old_access_jti = str(uuid.uuid4())
    user_id = str(uuid.uuid4())
    tenant_id = str(uuid.uuid4())

    # Build a minimal valid refresh token payload
    future_exp = int(time.time()) + 3600
    payload = {
        "sub": user_id,
        "jti": old_jti,
        "tenant_id": tenant_id,
        "iat": int(time.time()),
        "exp": future_exp,
        "type": "refresh",
        "access_jti": old_access_jti,
    }

    user = _make_user(user_id=user_id, tenant_id=tenant_id)
    mock_session = AsyncMock()
    mock_repo = AsyncMock()
    mock_repo.get_by_id.return_value = user

    mock_redis = AsyncMock()
    mock_redis.sismember = AsyncMock(return_value=False)  # Not revoked
    mock_redis.setex = AsyncMock()
    mock_redis.delete = AsyncMock()
    mock_redis.sadd = AsyncMock()
    mock_response = MagicMock()

    with (
        patch("app.domains.auth.service.AuthRepository", return_value=mock_repo),
        patch("app.domains.auth.service.get_session_redis", return_value=mock_redis),
        patch("app.domains.auth.service.create_access_token", return_value="new_access"),
        patch("app.domains.auth.service.create_refresh_token", return_value="new_refresh"),
        patch("app.domains.auth.service.set_auth_cookies"),
        patch("jose.jwt.decode", return_value=payload),
    ):
        from app.domains.auth.service import AuthService
        service = AuthService(mock_session)

        new_access, new_refresh = await service.refresh(
            refresh_token_value="old_refresh_token_value",
            app_context="web",
            response=mock_response,
        )

    assert new_access == "new_access"
    assert new_refresh == "new_refresh"

    # Old refresh JTI should be revoked
    sadd_args = [call.args for call in mock_redis.sadd.call_args_list]
    assert any(old_jti in str(args) for args in sadd_args)

    # Old session key should be deleted
    delete_args = [call.args for call in mock_redis.delete.call_args_list]
    assert any(old_access_jti in str(args) or old_jti in str(args) for args in delete_args)
