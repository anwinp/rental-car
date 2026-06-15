"""
Pytest fixtures for the RCM API test suite.

Session-scoped engine creates/drops all tables once per test run.
Function-scoped session rolls back after every test for isolation.
"""
from __future__ import annotations

import uuid
from typing import AsyncGenerator
from unittest.mock import AsyncMock

import fakeredis.aioredis
import pytest
import pytest_asyncio
from sqlalchemy import MetaData, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ---------------------------------------------------------------------------
# Test database URL — matches GitHub Actions postgres:16 service
# ---------------------------------------------------------------------------
TEST_DATABASE_URL = "postgresql+asyncpg://rcm_user:rcm_pass@localhost:5432/rcm_test"


def _collect_metadata() -> MetaData:
    """
    Import all ORM models so they register with their respective
    DeclarativeBase instances, then merge all per-domain metadata
    tables into one MetaData object for create_all / drop_all.

    Each domain uses its own Base to avoid circular imports.
    """
    # Trigger all model registrations via import
    from app.domains.auth.models import Base as AuthBase  # noqa: F401
    from app.domains.auth.models import StaffUser  # noqa: F401
    from app.domains.checkout.models import Base as CheckoutBase  # noqa: F401
    from app.domains.checkout.models import RentalAgreement, ShiftLog  # noqa: F401
    from app.domains.customers.models import Base as CustomerBase  # noqa: F401
    from app.domains.customers.models import Customer  # noqa: F401
    from app.domains.damage.models import Base as DamageBase  # noqa: F401
    from app.domains.damage.models import DamageClaim  # noqa: F401
    from app.domains.fleet.models import Base as FleetBase  # noqa: F401
    from app.domains.fleet.models import Vehicle, VehicleBlock, VehicleClass, VehicleStatusLog  # noqa: F401
    from app.domains.locations.models import Base as LocationBase  # noqa: F401
    from app.domains.locations.models import Location  # noqa: F401
    from app.domains.notifications.models import Base as NotificationBase  # noqa: F401
    from app.domains.notifications.models import NotificationLog, NotificationTemplate  # noqa: F401
    from app.domains.payments.models import Base as PaymentBase  # noqa: F401
    from app.domains.payments.models import Payment, ProcessedWebhook  # noqa: F401
    from app.domains.pricing.models import Base as PricingBase  # noqa: F401
    from app.domains.pricing.models import ExtrasCatalog, RateCode, RateScheduleItem  # noqa: F401
    from app.domains.reservations.models import Base as ReservationBase  # noqa: F401
    from app.domains.reservations.models import Reservation, ReservationVersion  # noqa: F401
    from app.domains.tenants.models import Base as TenantBase  # noqa: F401
    from app.domains.tenants.models import Tenant  # noqa: F401

    # Merge all per-domain tables into one MetaData for create_all
    merged = MetaData()
    all_bases = [
        AuthBase, CheckoutBase, CustomerBase, DamageBase, FleetBase,
        LocationBase, NotificationBase, PaymentBase, PricingBase,
        ReservationBase, TenantBase,
    ]
    for base in all_bases:
        for table in base.metadata.tables.values():
            table.to_metadata(merged)
    return merged


# ---------------------------------------------------------------------------
# Session-scoped engine — create tables once, drop at end
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture(scope="session")
async def engine():
    """Create test engine, create all tables, yield, drop all."""
    metadata = _collect_metadata()
    test_engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with test_engine.begin() as conn:
        await conn.run_sync(metadata.create_all)
    yield test_engine
    async with test_engine.begin() as conn:
        await conn.run_sync(metadata.drop_all)
    await test_engine.dispose()


# ---------------------------------------------------------------------------
# Function-scoped session — rolls back after each test
# ---------------------------------------------------------------------------


@pytest_asyncio.fixture
async def session(engine) -> AsyncGenerator[tuple[AsyncSession, str], None]:
    """Per-test async session that rolls back all changes after the test."""
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    test_tenant_id = str(uuid.uuid4())
    async with async_session() as sess:
        await sess.begin()
        # Inject GUC session variables so RLS policies and audit triggers fire correctly
        await sess.execute(
            text("SELECT set_config('app.current_tenant_id', :v, true)"),
            {"v": test_tenant_id},
        )
        await sess.execute(
            text("SELECT set_config('app.current_user_id', :v, true)"),
            {"v": str(uuid.uuid4())},
        )
        await sess.execute(
            text("SELECT set_config('app.current_role', :v, true)"),
            {"v": "SUPER_ADMIN"},
        )
        await sess.execute(
            text("SELECT set_config('app.client_ip', :v, true)"),
            {"v": "127.0.0.1"},
        )
        await sess.execute(
            text("SELECT set_config('app.request_id', :v, true)"),
            {"v": str(uuid.uuid4())},
        )
        yield sess, test_tenant_id
        await sess.rollback()


# ---------------------------------------------------------------------------
# Redis mock
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_redis():
    """fakeredis instance that resets between tests."""
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield redis


# ---------------------------------------------------------------------------
# Stripe mock
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_stripe():
    """Mock StripeClient with realistic pre-auth / capture return values."""
    client = AsyncMock()
    client.create_payment_intent.return_value = {
        "id": "pi_test_123",
        "status": "requires_capture",
        "client_secret": "pi_test_123_secret_456",
    }
    client.capture_payment_intent.return_value = {
        "id": "pi_test_123",
        "status": "succeeded",
        "latest_charge": "ch_test_789",
    }
    client.refund_payment_intent.return_value = {
        "id": "re_test_abc",
        "status": "succeeded",
        "amount": 10000,
    }
    return client


# ---------------------------------------------------------------------------
# Celery eager mode
# ---------------------------------------------------------------------------


@pytest.fixture
def celery_eager(celery_app):
    """Run Celery tasks synchronously (no broker) in unit tests."""
    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True
    yield
