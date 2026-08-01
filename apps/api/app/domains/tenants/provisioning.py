"""Tenant provisioning — give a new organisation a working application.

Creating a tenant row and an admin user is not enough to use RCM. The app
assumes reference data exists: without a rate code it cannot quote, without a
location vehicles have no home, without notification templates it cannot send a
confirmation. Previously that data reached the database only through the seed
files, which attach everything to one hard-coded tenant — so a newly registered
organisation signed in to software that could not take a booking.

This module is the single source of that baseline. Registration calls it, and
the seeds can call it too, so the two cannot drift apart.

Everything here runs inside the caller's transaction: a tenant is provisioned
completely or not at all. There is no half-built tenant to clean up.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Shared catalogues (vehicle classes, extras, notification templates, tax
# templates) live as global rows with tenant_id IS NULL and are readable by
# every tenant — see migration 053. They are deliberately NOT copied per tenant:
# duplicating 35 templates per organisation buys nothing and drifts immediately.
# What a tenant genuinely needs of its own is created below.


@dataclass
class ProvisionResult:
    """What provisioning actually created, for the onboarding checklist."""

    tenant_id: uuid.UUID
    admin_user_id: uuid.UUID
    location_id: uuid.UUID | None = None
    rate_code_id: uuid.UUID | None = None
    steps: list[str] = field(default_factory=list)


async def provision_tenant_defaults(
    session: AsyncSession,
    tenant_id: uuid.UUID,
    *,
    location_name: str = "Main Branch",
    location_code: str = "MAIN",
    city: str = "",
    country_code: str = "US",
    timezone: str = "America/New_York",
    currency: str = "USD",
) -> ProvisionResult:
    """Create the tenant-owned baseline a new organisation needs on day one.

    Idempotent: re-running against an already-provisioned tenant adds nothing.
    """
    result = ProvisionResult(tenant_id=tenant_id, admin_user_id=uuid.uuid4())

    # ── Starter location ─────────────────────────────────────────────────────
    # Vehicles need a home branch before any of them can be rented, so an
    # organisation with no location cannot complete its first booking.
    existing = (
        await session.execute(
            text("SELECT location_id FROM locations WHERE tenant_id = :t LIMIT 1"),
            {"t": str(tenant_id)},
        )
    ).first()

    if existing:
        result.location_id = existing[0]
    else:
        location_id = uuid.uuid4()
        await session.execute(
            text(
                """
                INSERT INTO locations (
                    location_id, tenant_id, short_code, name, location_type,
                    address_line1, city, country_code, timezone, currency,
                    is_active
                ) VALUES (
                    :id, :t, :code, :name, 'DOWNTOWN',
                    'Address to be completed', :city, :country, :tz, :cur,
                    true
                )
                """
            ),
            {
                "id": str(location_id),
                "t": str(tenant_id),
                "code": location_code[:10].upper(),
                "name": location_name,
                "city": city or location_name,
                "country": country_code,
                "tz": timezone,
                "cur": currency,
            },
        )
        result.location_id = location_id
        result.steps.append("starter_location")

    # ── Rack rate code ───────────────────────────────────────────────────────
    # Pricing resolves against a rate code; with none, every quote fails.
    existing_rate = (
        await session.execute(
            text("SELECT rate_code_id FROM rate_codes WHERE tenant_id = :t LIMIT 1"),
            {"t": str(tenant_id)},
        )
    ).first()

    if existing_rate:
        result.rate_code_id = existing_rate[0]
    else:
        rate_code_id = uuid.uuid4()
        await session.execute(
            text(
                """
                INSERT INTO rate_codes (
                    rate_code_id, tenant_id, code, description, rate_type,
                    currency, status, valid_from, valid_until,
                    blackout_dates, day_of_week_modifiers,
                    location_scope, location_ids,
                    vehicle_class_scope, vehicle_class_ids,
                    min_rental_days, prepay_required, refundable,
                    is_combinable, uses_count, gds_eligible
                ) VALUES (
                    :id, :t, 'RACK', 'Standard Walk-up Rate', 'RACK',
                    :cur, 'ACTIVE', :from_date, :until_date,
                    '[]', '{}',
                    'ALL', '{}',
                    'ALL', '{}',
                    1, false, true,
                    false, 0, false
                )
                """
            ),
            {
                "id": str(rate_code_id),
                "t": str(tenant_id),
                "cur": currency,
                "from_date": date(2024, 1, 1),
                "until_date": date(2035, 12, 31),
            },
        )
        result.rate_code_id = rate_code_id
        result.steps.append("rack_rate_code")

    # ── Rate schedule items ──────────────────────────────────────────────────
    # A rate code on its own prices nothing. Quoting resolves
    # (rate_code, vehicle_class) -> rate_schedule_items, so a tenant with a RACK
    # code and no items gets an empty quote for every search — which is what
    # every self-service workspace had: 1 rate code, 0 items. The onboarding
    # checklist then asked them to "add your fleet" and nothing they added could
    # be priced.
    #
    # These are placeholder prices, and deliberately obvious ones. The intent is
    # that a new workspace can complete a booking end to end on day one and then
    # edit the numbers, rather than hitting a dead end it has no way to diagnose.
    if result.rate_code_id:
        existing_items = (
            await session.execute(
                text(
                    "SELECT count(*) FROM rate_schedule_items "
                    "WHERE tenant_id = :t AND rate_code_id = :rc"
                ),
                {"t": str(tenant_id), "rc": str(result.rate_code_id)},
            )
        ).scalar() or 0

        if existing_items == 0:
            # Price off the shared catalogue, which every tenant can read, so
            # the ladder stays sensible as classes are added centrally.
            classes = (
                await session.execute(
                    text(
                        "SELECT class_id, sort_order FROM vehicle_classes "
                        "WHERE tenant_id IS NULL OR tenant_id = :t "
                        "ORDER BY sort_order NULLS LAST"
                    ),
                    {"t": str(tenant_id)},
                )
            ).fetchall()

            created = 0
            for class_id, sort_order in classes:
                # Roughly the shape of a real rack ladder: Mini around 30/day
                # rising to ~130 for the top classes.
                step = int(sort_order or 1)
                per_day = Decimal(25 + step * 9)
                await session.execute(
                    text(
                        """
                        INSERT INTO rate_schedule_items (
                            item_id, tenant_id, rate_code_id, vehicle_class_id,
                            days_min, days_max,
                            price_per_day, price_per_week, price_per_month,
                            free_miles_per_day, overage_rate_per_mile
                        ) VALUES (
                            :id, :t, :rc, :vc,
                            1, NULL,
                            :day, :week, :month,
                            :miles, :overage
                        )
                        """
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "t": str(tenant_id),
                        "rc": str(result.rate_code_id),
                        "vc": str(class_id),
                        "day": per_day,
                        # Weekly ~6.5x daily, monthly ~25x — the usual discount
                        # shape so longer rentals do not price above shorter ones.
                        "week": (per_day * Decimal("6.5")).quantize(Decimal("0.01")),
                        "month": (per_day * Decimal(25)).quantize(Decimal("0.01")),
                        "miles": 150,
                        "overage": Decimal("0.25"),
                    },
                )
                created += 1

            if created:
                result.steps.append(f"rate_schedule_items:{created}")

    return result


async def readiness_checklist(
    session: AsyncSession, tenant_id: uuid.UUID
) -> list[dict]:
    """What still stands between this organisation and its first booking.

    Drives the onboarding UI. Each item is either satisfied by provisioning or
    is genuine work only the organisation can do (adding real vehicles, real
    addresses, real staff).
    """
    counts = (
        await session.execute(
            text(
                """
                SELECT
                  (SELECT count(*) FROM locations   WHERE tenant_id = :t AND is_active) AS locations,
                  (SELECT count(*) FROM vehicles    WHERE tenant_id = :t)               AS vehicles,
                  (SELECT count(*) FROM rate_codes  WHERE tenant_id = :t
                     AND status = 'ACTIVE')                                             AS rates,
                  (SELECT count(*) FROM staff_users WHERE tenant_id = :t
                     AND is_active)                                                     AS staff,
                  (SELECT count(*) FROM vehicle_classes
                     WHERE tenant_id IS NULL OR tenant_id = :t)                         AS classes
                """
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().first()

    c = counts or {}
    return [
        {
            "key": "location",
            "label": "Add a branch",
            "detail": "Where customers collect and return vehicles.",
            "done": (c.get("locations") or 0) > 0,
            "count": c.get("locations") or 0,
            "self_serve": True,
        },
        {
            "key": "rate",
            "label": "Set up pricing",
            "detail": "A rate code so the system can quote a booking.",
            "done": (c.get("rates") or 0) > 0,
            "count": c.get("rates") or 0,
            "self_serve": True,
        },
        {
            "key": "classes",
            "label": "Vehicle classes available",
            "detail": "The standard SIPP catalogue, shared across the platform.",
            "done": (c.get("classes") or 0) > 0,
            "count": c.get("classes") or 0,
            "self_serve": True,
        },
        {
            "key": "vehicles",
            "label": "Add your fleet",
            "detail": "At least one vehicle before you can take a booking.",
            "done": (c.get("vehicles") or 0) > 0,
            "count": c.get("vehicles") or 0,
            "self_serve": False,
        },
        {
            "key": "staff",
            "label": "Invite your team",
            "detail": "Counter staff and managers who will run the branch.",
            "done": (c.get("staff") or 0) > 1,
            "count": c.get("staff") or 0,
            "self_serve": False,
        },
    ]
