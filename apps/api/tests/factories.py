"""
factory_boy model factories for all 12 core domain tables.

Usage in tests:
    from tests.factories import VehicleFactory, TenantFactory

    tenant = TenantFactory(session=sess)
    vehicle = VehicleFactory(session=sess, tenant_id=tenant.tenant_id)

All factories use sqlalchemy_session_persistence="flush" so the object is
flushed (but not committed) — the test session's rollback fixture handles
cleanup.
"""
from __future__ import annotations

import random
import string
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import factory
from factory.alchemy import SQLAlchemyModelFactory

from app.domains.auth.models import StaffUser
from app.domains.checkout.models import RentalAgreement
from app.domains.customers.models import Customer
from app.domains.damage.models import DamageClaim
from app.domains.fleet.models import Vehicle, VehicleClass
from app.domains.locations.models import Location
from app.domains.notifications.models import NotificationTemplate
from app.domains.payments.models import Payment
from app.domains.pricing.models import RateCode
from app.domains.reservations.models import Reservation
from app.domains.tenants.models import Tenant


def _rand_str(length: int = 6, chars: str = string.ascii_uppercase + string.digits) -> str:
    return "".join(random.choices(chars, k=length))  # noqa: S311


# ---------------------------------------------------------------------------
# TenantFactory
# ---------------------------------------------------------------------------


class TenantFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Tenant
        sqlalchemy_session_persistence = "flush"

    tenant_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    slug = factory.LazyAttribute(lambda o: f"tenant-{o.tenant_id[:8]}")
    legal_name = factory.Faker("company")
    trading_name = factory.LazyAttribute(lambda o: o.legal_name)
    primary_email = factory.Faker("email")
    billing_address = factory.LazyFunction(dict)
    default_currency = "USD"
    default_timezone = "America/Chicago"
    subscription_tier = "PROFESSIONAL"
    is_active = True
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# LocationFactory
# ---------------------------------------------------------------------------


class LocationFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Location
        sqlalchemy_session_persistence = "flush"

    location_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    name = factory.Faker("city")
    short_code = factory.LazyFunction(lambda: _rand_str(3, string.ascii_uppercase))
    location_type = "DOWNTOWN"
    address_line1 = factory.Faker("street_address")
    city = factory.Faker("city")
    state_province = factory.Faker("state_abbr")
    postal_code = factory.Faker("postcode")
    country_code = "US"
    timezone = "America/Chicago"
    is_active = True
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# VehicleClassFactory
# ---------------------------------------------------------------------------


_SIPP_ITER = iter(["E", "C", "I", "S", "F", "P"])
_CLASS_NAMES = iter(["Economy", "Compact", "Intermediate", "Standard", "Fullsize", "Premium"])


class VehicleClassFactory(SQLAlchemyModelFactory):
    class Meta:
        model = VehicleClass
        sqlalchemy_session_persistence = "flush"

    class_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = None  # NULL = system-wide
    sipp_prefix = factory.Faker(
        "random_element", elements=["E", "C", "I", "S", "F", "P", "L", "M"]
    )
    name = factory.Faker(
        "random_element",
        elements=["Economy", "Compact", "Intermediate", "Standard", "Fullsize", "Premium"],
    )
    is_active = True
    sort_order = 0
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# StaffUserFactory
# ---------------------------------------------------------------------------


class StaffUserFactory(SQLAlchemyModelFactory):
    class Meta:
        model = StaffUser
        sqlalchemy_session_persistence = "flush"

    user_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    email = factory.Faker("email")
    hashed_password = "$2b$12$placeholder_hash_for_test_use_only_xxxxxxxxxxxxxxxxxx"
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    role = "COUNTER_AGENT"
    is_active = True
    is_mfa_enabled = False
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# VehicleFactory
# ---------------------------------------------------------------------------


class VehicleFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Vehicle
        sqlalchemy_session_persistence = "flush"

    vehicle_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    location_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    class_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    vin = factory.LazyFunction(
        lambda: "".join(
            random.choices("ABCDEFGHJKLMNPRSTUVWXYZ0123456789", k=17)  # noqa: S311
        )
    )
    plate = factory.LazyFunction(lambda: _rand_str(7))
    make = factory.Faker("random_element", elements=["Toyota", "Honda", "Ford", "Chevrolet"])
    model = factory.Faker("random_element", elements=["Camry", "Civic", "Focus", "Malibu"])
    model_year = factory.Faker("random_int", min=2019, max=2024)
    color = factory.Faker("color_name")
    status = "AVAILABLE"
    fuel_type = "GASOLINE"
    transmission = "AUTOMATIC"
    seat_count = 5
    odometer_current = factory.Faker("random_int", min=0, max=50000)
    is_active = True
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# CustomerFactory
# ---------------------------------------------------------------------------


class CustomerFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Customer
        sqlalchemy_session_persistence = "flush"

    customer_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    first_name = factory.Faker("first_name")
    last_name = factory.Faker("last_name")
    email = factory.Faker("email")
    email_verified = False
    mobile_phone = factory.Faker("phone_number")
    account_status = "ACTIVE"
    kyc_status = "UNVERIFIED"
    dnr_flag = False
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# RateCodeFactory
# ---------------------------------------------------------------------------


class RateCodeFactory(SQLAlchemyModelFactory):
    class Meta:
        model = RateCode
        sqlalchemy_session_persistence = "flush"

    rate_code_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    code = factory.LazyFunction(lambda: f"RATE-{_rand_str(4, string.digits)}")
    description = factory.Faker("bs")
    rate_type = "RACK"
    is_active = True
    valid_from = factory.LazyFunction(
        lambda: datetime.now(timezone.utc) - timedelta(days=30)
    )
    valid_to = factory.LazyFunction(
        lambda: datetime.now(timezone.utc) + timedelta(days=365)
    )
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# ReservationFactory
# ---------------------------------------------------------------------------


class ReservationFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Reservation
        sqlalchemy_session_persistence = "flush"

    reservation_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    customer_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    pickup_location_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    dropoff_location_id = factory.LazyAttribute(lambda o: str(o.pickup_location_id))
    class_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    confirmation_number = factory.LazyFunction(
        lambda: (
            f"RCM-{datetime.now():%Y%m%d}-"
            + _rand_str(6, string.ascii_uppercase + string.digits)
        )
    )
    status = "CONFIRMED"
    version = 1
    pickup_datetime = factory.LazyFunction(
        lambda: datetime.now(timezone.utc) + timedelta(days=1)
    )
    dropoff_datetime = factory.LazyFunction(
        lambda: datetime.now(timezone.utc) + timedelta(days=4)
    )
    base_daily_rate = Decimal("45.00")
    total_estimated = Decimal("162.00")
    currency = "USD"
    booking_source = "DIRECT"
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# RentalAgreementFactory
# ---------------------------------------------------------------------------


class RentalAgreementFactory(SQLAlchemyModelFactory):
    class Meta:
        model = RentalAgreement
        sqlalchemy_session_persistence = "flush"

    ra_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    reservation_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    customer_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    vehicle_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    ra_number = factory.LazyFunction(
        lambda: f"RA-{datetime.now():%Y%m%d}-{_rand_str(6)}"
    )
    vin_at_checkout = factory.LazyFunction(
        lambda: "".join(
            random.choices("ABCDEFGHJKLMNPRSTUVWXYZ0123456789", k=17)  # noqa: S311
        )
    )
    status = "CHECKED_OUT"
    odometer_out = 15000
    fuel_level_out_pct = 80
    picked_up_at = factory.LazyFunction(
        lambda: datetime.now(timezone.utc) - timedelta(hours=3)
    )
    is_training_ra = False
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# PaymentFactory
# ---------------------------------------------------------------------------


class PaymentFactory(SQLAlchemyModelFactory):
    class Meta:
        model = Payment
        sqlalchemy_session_persistence = "flush"

    payment_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    reservation_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    payment_method = "CREDIT_CARD"
    status = "AUTHORIZED"
    payment_type = "PREAUTH"
    amount = Decimal("300.00")
    currency = "USD"
    refunded_amount = Decimal("0.00")
    stripe_payment_intent_id = factory.LazyFunction(
        lambda: f"pi_test_{_rand_str(18, string.ascii_lowercase + string.digits)}"
    )
    auth_expiry_at = factory.LazyFunction(
        lambda: datetime.now(timezone.utc) + timedelta(days=6)
    )
    card_last4 = "4242"
    card_brand = "visa"
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# DamageClaimFactory
# ---------------------------------------------------------------------------


class DamageClaimFactory(SQLAlchemyModelFactory):
    class Meta:
        model = DamageClaim
        sqlalchemy_session_persistence = "flush"

    claim_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    rental_agreement_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    vehicle_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    customer_id = factory.LazyAttribute(lambda o: str(uuid.uuid4()))
    claim_reference = factory.LazyFunction(
        lambda: f"CLM-{datetime.now():%Y%m%d}-{_rand_str(5, string.ascii_uppercase)}"
    )
    status = "OPEN"
    discovered_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# NotificationTemplateFactory
# ---------------------------------------------------------------------------


class NotificationTemplateFactory(SQLAlchemyModelFactory):
    class Meta:
        model = NotificationTemplate
        sqlalchemy_session_persistence = "flush"

    template_id = factory.LazyFunction(lambda: str(uuid.uuid4()))
    tenant_id = None  # system-wide template by default
    event_code = "RESERVATION_CONFIRMED"
    channel = "EMAIL"
    subject = "Your reservation {{ confirmation_number }} is confirmed"
    body_text = "Dear {{ first_name }}, your reservation {{ confirmation_number }} is confirmed."
    is_active = True
    created_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
    updated_at = factory.LazyFunction(lambda: datetime.now(timezone.utc))
