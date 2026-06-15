"""
Unit tests for CustomerService.

All external dependencies (DB session, repository) are mocked.
Tests verify customer business logic in isolation.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.exceptions import DuplicateError, GDPRLegalHoldError, BusinessRuleError
from app.domains.customers.schemas import (
    CustomerCreate,
    DNRCreate,
    DNRScope,
    GDPRErasureRequest,
    CustomerSearchQuery,
    AccountType,
)


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_customer(
    customer_id: Optional[str] = None,
    email: str = "jane@example.com",
    first_name: str = "Jane",
    last_name: str = "Doe",
    tenant_id: Optional[str] = None,
    dnr_flag: bool = False,
    dnr_scope: Optional[str] = None,
    dnr_reason: Optional[str] = None,
    dnr_expiry: Optional[date] = None,
    dnr_incident_ref: Optional[str] = None,
    anonymized_at: Optional[datetime] = None,
    updated_at: Optional[datetime] = None,
    license_number: Optional[str] = None,
    license_state: Optional[str] = None,
    license_country: Optional[str] = None,
    license_expiry: Optional[date] = None,
) -> MagicMock:
    customer = MagicMock()
    customer.customer_id = customer_id or str(uuid.uuid4())
    customer.email = email
    customer.first_name = first_name
    customer.last_name = last_name
    customer.tenant_id = tenant_id or str(uuid.uuid4())
    customer.dnr_flag = dnr_flag
    customer.dnr_scope = dnr_scope
    customer.dnr_reason = dnr_reason
    customer.dnr_expiry = dnr_expiry
    customer.dnr_incident_ref = dnr_incident_ref
    customer.anonymized_at = anonymized_at
    customer.updated_at = updated_at or datetime.now(timezone.utc)
    customer.license_number = license_number
    customer.license_state = license_state
    customer.license_country = license_country
    customer.license_expiry = license_expiry
    return customer


def _make_service(
    repo_overrides: Optional[dict] = None,
    session_overrides: Optional[dict] = None,
):
    """Create a CustomerService with mocked repo and session."""
    from app.domains.customers.service import CustomerService

    mock_session = AsyncMock()
    # Default: no active RAs or damage claims
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    mock_session.execute.return_value = mock_result

    tenant_id = uuid.uuid4()
    svc = CustomerService.__new__(CustomerService)
    svc._session = mock_session
    svc._tenant_id = tenant_id

    mock_repo = AsyncMock()
    # Defaults
    mock_repo.get_by_email.return_value = None
    mock_repo.get.return_value = None
    mock_repo.update.return_value = MagicMock()
    mock_repo.list.return_value = []
    mock_repo.fulltext_search.return_value = []
    mock_repo.get_active_dnr_customers.return_value = []

    if repo_overrides:
        for attr, val in repo_overrides.items():
            setattr(mock_repo, attr, val)

    if session_overrides:
        for attr, val in session_overrides.items():
            setattr(mock_session, attr, val)

    svc._repo = mock_repo
    return svc, mock_repo, mock_session, tenant_id


# ── test_duplicate_email_raises_error ─────────────────────────────────────────

@pytest.mark.asyncio
async def test_duplicate_email_raises_error():
    """
    Creating a customer with an email that already exists for the tenant
    must raise DuplicateError before any DB write.
    """
    existing_customer = _make_customer(email="jane@example.com")
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={"get_by_email": AsyncMock(return_value=existing_customer)}
    )

    data = CustomerCreate(
        first_name="Jane",
        last_name="Doe",
        email="jane@example.com",
        phone="+15551234567",
    )

    with pytest.raises(DuplicateError) as exc_info:
        await svc.create_customer(data, tenant_id)

    assert "jane@example.com" in str(exc_info.value).lower() or "already exists" in str(exc_info.value).lower()
    mock_repo.create.assert_not_called()


@pytest.mark.asyncio
async def test_create_customer_normalizes_email():
    """Email must be lowercased before storing."""
    new_customer = _make_customer(email="upper@example.com")
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={
            "get_by_email": AsyncMock(return_value=None),
            "create": AsyncMock(return_value=new_customer),
        }
    )

    data = CustomerCreate(
        first_name="Upper",
        last_name="Case",
        email="UPPER@EXAMPLE.COM",
        phone="+15551234567",
    )

    result = await svc.create_customer(data, tenant_id)

    # Verify create was called with lowercased email
    call_kwargs = mock_repo.create.call_args.kwargs
    assert call_kwargs["email"] == "upper@example.com"


# ── test_dnr_network_scope_blocks_everywhere ──────────────────────────────────

@pytest.mark.asyncio
async def test_dnr_network_scope_blocks_everywhere():
    """
    A customer with NETWORK-scope DNR must be blocked regardless of location.
    The reason field must be present in the result (visible to counter agents).
    """
    customer_id = uuid.uuid4()
    customer = _make_customer(
        customer_id=str(customer_id),
        dnr_flag=True,
        dnr_scope="NETWORK",
        dnr_reason="FRAUD: Credit card theft",
        dnr_expiry=None,  # No expiry → permanent block
    )
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=customer)}
    )

    # No location provided (network scope blocks everywhere)
    result = await svc.check_dnr(customer_id, tenant_id, location_id=None)

    assert result.is_blocked is True
    assert result.scope == DNRScope.NETWORK
    # Reason must be accessible to agents (not suppressed at service layer)
    assert result.reason is not None
    assert "FRAUD" in result.reason


@pytest.mark.asyncio
async def test_dnr_network_scope_blocks_with_location_provided():
    """NETWORK scope blocks even when a specific location is provided."""
    customer_id = uuid.uuid4()
    customer = _make_customer(
        customer_id=str(customer_id),
        dnr_flag=True,
        dnr_scope="NETWORK",
        dnr_reason="VIOLENT_INCIDENT",
        dnr_expiry=None,
    )
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=customer)}
    )

    result = await svc.check_dnr(customer_id, tenant_id, location_id=uuid.uuid4())

    assert result.is_blocked is True
    assert result.scope == DNRScope.NETWORK


# ── test_dnr_location_scope_blocks_only_at_location ──────────────────────────

@pytest.mark.asyncio
async def test_dnr_location_scope_blocks_only_at_matching_location():
    """
    A customer with LOCATION-scope DNR must be blocked only at the specific
    location stored in dnr_incident_ref.
    """
    customer_id = uuid.uuid4()
    blocked_location_id = uuid.uuid4()

    customer = _make_customer(
        customer_id=str(customer_id),
        dnr_flag=True,
        dnr_scope="LOCATION",
        dnr_reason="PROPERTY_DAMAGE",
        dnr_incident_ref=str(blocked_location_id),
    )
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=customer)}
    )

    # At the blocked location → should be blocked
    result_blocked = await svc.check_dnr(
        customer_id, tenant_id, location_id=blocked_location_id
    )
    assert result_blocked.is_blocked is True

    # At a different location → should NOT be blocked
    result_allowed = await svc.check_dnr(
        customer_id, tenant_id, location_id=uuid.uuid4()
    )
    assert result_allowed.is_blocked is False


@pytest.mark.asyncio
async def test_dnr_location_scope_no_location_provided_is_blocked():
    """Without location context, LOCATION-scope DNR is treated conservatively as blocked."""
    customer_id = uuid.uuid4()
    blocked_location_id = uuid.uuid4()

    customer = _make_customer(
        customer_id=str(customer_id),
        dnr_flag=True,
        dnr_scope="LOCATION",
        dnr_reason="NOISE_COMPLAINT",
        dnr_incident_ref=str(blocked_location_id),
    )
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=customer)}
    )

    result = await svc.check_dnr(customer_id, tenant_id, location_id=None)
    assert result.is_blocked is True


# ── test_dnr_expiry_auto_clear ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_expired_dnr_is_auto_cleared():
    """
    An expired DNR flag must be auto-cleared and the customer must be returned
    as NOT blocked without requiring a manual admin action.
    """
    customer_id = uuid.uuid4()
    expired_customer = _make_customer(
        customer_id=str(customer_id),
        dnr_flag=True,
        dnr_scope="NETWORK",
        dnr_reason="MINOR_INCIDENT",
        dnr_expiry=date(2020, 1, 1),  # Expired
    )
    svc, mock_repo, _, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=expired_customer)}
    )

    result = await svc.check_dnr(customer_id, tenant_id)

    assert result.is_blocked is False
    # Auto-clear must have been called
    mock_repo.update.assert_awaited_once()
    update_kwargs = mock_repo.update.call_args.kwargs
    assert update_kwargs.get("dnr_flag") is False


# ── test_gdpr_erasure_with_active_rental_raises_legal_hold ───────────────────

@pytest.mark.asyncio
async def test_gdpr_erasure_with_active_rental_raises_legal_hold():
    """
    GDPR erasure must be refused if the customer has an active rental agreement.
    GDPRLegalHoldError must be raised — never silently skipped.

    Security invariant: GDPR erasure must check legal holds first — never wipe
    records under active dispute or within retention period.
    """
    customer_id = uuid.uuid4()
    customer = _make_customer(customer_id=str(customer_id))

    # Simulate an active RA found in the DB
    mock_active_ra = MagicMock()
    mock_active_ra.ra_id = str(uuid.uuid4())
    mock_active_ra.status = "ACTIVE"

    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_active_ra

    svc, mock_repo, mock_session, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=customer)},
        session_overrides={"execute": AsyncMock(return_value=mock_result)},
    )

    request = GDPRErasureRequest(reason="Customer request", verified_identity=True)

    with pytest.raises(GDPRLegalHoldError) as exc_info:
        await svc.gdpr_erasure(customer_id, tenant_id, uuid.uuid4(), request)

    # PII must NOT have been modified
    mock_repo.update.assert_not_called()
    # GDPRLegalHoldError must be raised — the message contains "legal hold" or the customer id
    assert exc_info.type == GDPRLegalHoldError


@pytest.mark.asyncio
async def test_gdpr_erasure_anonymizes_pii_fields():
    """
    GDPR erasure with no legal holds must anonymize all PII fields in-place.
    The row must not be deleted — only overwritten.
    """
    customer_id = uuid.uuid4()
    customer = _make_customer(
        customer_id=str(customer_id),
        email="jane@example.com",
        first_name="Jane",
        last_name="Doe",
    )

    # No active RA or damage claims
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = None
    svc, mock_repo, mock_session, tenant_id = _make_service(
        repo_overrides={"get": AsyncMock(return_value=customer)},
        session_overrides={"execute": AsyncMock(return_value=mock_result)},
    )

    request = GDPRErasureRequest(reason="User requested erasure", verified_identity=True)

    await svc.gdpr_erasure(customer_id, tenant_id, uuid.uuid4(), request)

    # Anonymization must have been called
    mock_repo.update.assert_awaited_once()
    update_kwargs = mock_repo.update.call_args.kwargs

    assert update_kwargs.get("first_name") == "ANONYMIZED"
    assert update_kwargs.get("last_name") == "ANONYMIZED"
    assert update_kwargs.get("email") == f"anon_{customer_id}@deleted.invalid"
    assert update_kwargs.get("mobile_phone") is None
    assert update_kwargs.get("date_of_birth") is None
    assert update_kwargs.get("license_number") is None
    # anonymized_at must be set
    assert update_kwargs.get("anonymized_at") is not None
