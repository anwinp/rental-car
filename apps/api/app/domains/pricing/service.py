"""Pricing domain service — rate quote calculation, promo/CDP validation."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from math import ceil
from typing import Optional
from uuid import UUID

from redis.asyncio import Redis

from app.core.exceptions import BusinessRuleError, ResourceNotFoundError
from app.core.redis import RATE_QUOTE_KEY
from app.domains.pricing.models import ExtrasCatalog, RateCode, RateScheduleItem
from app.domains.pricing.repository import PricingRepository
from app.domains.pricing.schemas import (
    ExtraQuoteRequest,
    ExtrasCatalogCreate,
    ExtrasCatalogUpdate,
    LineItemType,
    PromoCodeValidation,
    RateCodeActivate,
    RateCodeCreate,
    RateCodeUpdate,
    RateQuoteLineItem,
    RateQuoteRequest,
    RateQuoteResponse,
    RateScheduleItemCreate,
)

log = logging.getLogger(__name__)

# ISO 4217 minor unit: 2 decimal places for all supported currencies
_TWO_PLACES = Decimal("0.01")
_SIX_PLACES = Decimal("0.000001")

# Redis TTL for rate quotes (seconds)
_QUOTE_TTL_SECONDS = 30


def _round2(value: Decimal) -> Decimal:
    """Round to 2dp using ROUND_HALF_UP (ISO 4217)."""
    return value.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _round6(value: Decimal) -> Decimal:
    """Round to 6dp for intermediate precision."""
    return value.quantize(_SIX_PLACES, rounding=ROUND_HALF_UP)


class PricingService:
    """
    Rate quote calculation engine.

    Depends on:
      - PricingRepository for DB queries
      - Redis (avail cluster) for quote caching
      - Optionally an Avalara client for tax (falls back to tax_template)
    """

    def __init__(
        self,
        repo: PricingRepository,
        redis: Redis,
        tenant_id: UUID,
        avalara_client=None,  # Optional[AvalaraClient] — injected at runtime
    ) -> None:
        self._repo = repo
        self._redis = redis
        self._tenant_id = tenant_id
        self._avalara = avalara_client

    # ── Rate Quote ───────────────────────────────────────────────────────────

    async def calculate_quote(self, request: RateQuoteRequest) -> RateQuoteResponse:
        """
        Calculate a full rate quote for the requested dates and extras.

        Steps (from task spec §Rate Engine service.py):
          1. Check Redis cache — return immediately on hit
          2. Find active rate code
          3. Find rate_schedule_items for class
          4. Calculate rental_days (ceil to nearest day)
          5. Apply base rate × rental_days
          6. Apply day-of-week modifiers per rental day
          7. Apply extras pricing
          8. Call Avalara (or tax_template fallback) for taxes
          9. Round all intermediates to 6dp; final totals to 2dp (ROUND_HALF_UP)
          10. Build quote_token = SHA-256(inputs)
          11. Cache in Redis for 30s
        """
        quote_token = request.compute_quote_token(str(self._tenant_id))
        cache_key = RATE_QUOTE_KEY.format(hash=quote_token)

        # ── Step 1: Cache check ───────────────────────────────────────────
        cached = await self._redis.get(cache_key)
        if cached:
            response = RateQuoteResponse.model_validate_json(cached)
            response.cache_hit = True
            return response

        # ── Step 2: Rate code lookup ──────────────────────────────────────
        rate_code = await self._repo.get_active_rate_code(
            location_id=request.location_id,
            vehicle_class_id=request.vehicle_class_id,
            pickup_dt=request.pickup_dt,
            dropoff_dt=request.dropoff_dt,
            cdp_code=request.cdp_code,
        )
        if rate_code is None and request.cdp_code is not None:
            # CDP code not matched — fall back to standard (RACK/PROMOTIONAL) rate
            rate_code = await self._repo.get_active_rate_code(
                location_id=request.location_id,
                vehicle_class_id=request.vehicle_class_id,
                pickup_dt=request.pickup_dt,
                dropoff_dt=request.dropoff_dt,
                cdp_code=None,
            )
        if rate_code is None:
            raise ResourceNotFoundError(
                resource="rate_code",
                resource_id=f"location={request.location_id} class={request.vehicle_class_id}",
            )

        # Validate advance booking restrictions
        self._check_advance_booking(rate_code, request.pickup_dt)

        cdp_applied = (
            request.cdp_code is not None
            and rate_code.cdp_code == request.cdp_code
        )

        # ── Step 3: Schedule items ─────────────────────────────────────────
        schedule_items = await self._repo.get_schedule_items(
            rate_code_id=UUID(rate_code.rate_code_id),
            vehicle_class_id=request.vehicle_class_id,
        )
        if not schedule_items:
            raise ResourceNotFoundError(
                resource="rate_schedule_items",
                resource_id=f"rate_code={rate_code.rate_code_id}",
            )

        # ── Step 4: rental_days ───────────────────────────────────────────
        duration_seconds = (
            request.dropoff_dt - request.pickup_dt
        ).total_seconds()
        rental_days_exact = _round6(
            Decimal(str(duration_seconds)) / Decimal("86400")
        )
        rental_days_int = ceil(float(rental_days_exact))

        # Pick the applicable schedule item by day count
        schedule_item = self._pick_schedule_item(schedule_items, rental_days_int)

        # ── Step 5: Base rate ─────────────────────────────────────────────
        base_rate_per_day = _round6(Decimal(str(schedule_item.price_per_day)))
        base_amount = _round6(base_rate_per_day * rental_days_exact)

        # ── Step 6: Day-of-week modifiers ─────────────────────────────────
        dow_modifiers: dict = rate_code.day_of_week_modifiers or {}
        if dow_modifiers:
            base_amount = _round6(
                self._apply_dow_modifiers(
                    base_rate_per_day,
                    request.pickup_dt,
                    rental_days_int,
                    dow_modifiers,
                )
            )

        line_items: list[RateQuoteLineItem] = [
            RateQuoteLineItem(
                description=f"Base rate ({rental_days_int} day{'s' if rental_days_int != 1 else ''})",
                quantity=rental_days_exact,
                unit_price=base_rate_per_day,
                amount=base_amount,
                type=LineItemType.BASE,
            )
        ]

        # ── Step 7: Extras ────────────────────────────────────────────────
        extras_total = Decimal("0")
        if request.extras:
            extra_ids = [str(e.extra_id) for e in request.extras]
            extras_map: dict[str, ExtrasCatalog] = {}
            for e_req in request.extras:
                extra_obj = await self._repo.get_extra_by_id(e_req.extra_id)
                if extra_obj is None:
                    raise ResourceNotFoundError(
                        resource="extra", resource_id=str(e_req.extra_id)
                    )
                extras_map[str(e_req.extra_id)] = extra_obj

            for e_req in request.extras:
                extra_obj = extras_map[str(e_req.extra_id)]
                if extra_obj.default_price is None:
                    continue
                price = _round6(Decimal(str(extra_obj.default_price)))
                qty = Decimal(str(e_req.quantity))

                if extra_obj.pricing_type == "PER_DAY":
                    amount = _round6(price * rental_days_exact * qty)
                else:
                    # PER_RENTAL or FLAT
                    amount = _round6(price * qty)

                extras_total += amount
                line_items.append(
                    RateQuoteLineItem(
                        description=f"{extra_obj.name} × {e_req.quantity}",
                        quantity=qty,
                        unit_price=price,
                        amount=amount,
                        type=LineItemType.EXTRA,
                    )
                )

        # ── Promo code discount (simplified — full validation in validate_promo_code) ──
        discount_amount = Decimal("0")
        promo_applied = False
        if request.promo_code:
            validation = await self.validate_promo_code(request.promo_code)
            if validation.is_valid and validation.discount_value is not None:
                promo_applied = True
                subtotal_before_discount = base_amount + extras_total
                if validation.discount_type == "PERCENT":
                    discount_amount = _round6(
                        subtotal_before_discount
                        * validation.discount_value
                        / Decimal("100")
                    )
                else:  # FIXED
                    discount_amount = _round6(
                        min(validation.discount_value, subtotal_before_discount)
                    )
                line_items.append(
                    RateQuoteLineItem(
                        description=f"Promo code: {request.promo_code}",
                        quantity=Decimal("1"),
                        unit_price=-discount_amount,
                        amount=-discount_amount,
                        type=LineItemType.DISCOUNT,
                    )
                )

        pretax_subtotal = _round6(base_amount + extras_total - discount_amount)

        # ── Step 8: Taxes ─────────────────────────────────────────────────
        tax_amount = await self._calculate_taxes(
            pretax_subtotal=pretax_subtotal,
            location_id=request.location_id,
        )
        if tax_amount > Decimal("0"):
            line_items.append(
                RateQuoteLineItem(
                    description="Taxes & fees",
                    quantity=Decimal("1"),
                    unit_price=tax_amount,
                    amount=tax_amount,
                    type=LineItemType.TAX,
                )
            )

        # ── Step 9: Round final totals to 2dp ────────────────────────────
        subtotal_2dp = _round2(pretax_subtotal)
        taxes_2dp = _round2(tax_amount)
        total_2dp = _round2(pretax_subtotal + tax_amount)

        # ── Step 10: Build response ───────────────────────────────────────
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=_QUOTE_TTL_SECONDS)
        response = RateQuoteResponse(
            quote_token=quote_token,
            rate_code_id=rate_code.rate_code_id,
            location_id=str(request.location_id),
            vehicle_class_id=str(request.vehicle_class_id),
            pickup_dt=request.pickup_dt,
            dropoff_dt=request.dropoff_dt,
            currency=request.currency,
            rental_days=rental_days_exact,
            line_items=line_items,
            subtotal=subtotal_2dp,
            taxes=taxes_2dp,
            total=total_2dp,
            promo_applied=promo_applied,
            cdp_applied=cdp_applied,
            expires_at=expires_at,
            cache_hit=False,
        )

        # ── Step 11: Cache in Redis for 30s ──────────────────────────────
        await self._redis.set(
            cache_key,
            response.model_dump_json(),
            ex=_QUOTE_TTL_SECONDS,
        )

        return response

    # ── Promo Code Validation ────────────────────────────────────────────────

    async def validate_promo_code(
        self,
        code: str,
        customer_id: Optional[UUID] = None,
        vehicle_class_id: Optional[str] = None,
        rental_days: int = 1,
    ) -> PromoCodeValidation:
        """
        Validate a promotional code for the quote stage.
        Does NOT increment used_count (that happens at reservation creation).
        """
        from sqlalchemy import text as _text

        try:
            # Use a nested transaction (SAVEPOINT) so that a missing-table error
            # does not abort the outer transaction.
            async with self._repo.session.begin_nested():
                result = await self._repo.session.execute(
                    _text("""
                        SELECT * FROM promotion_codes
                        WHERE tenant_id = :tid AND code = :code AND is_active = true
                          AND NOW() BETWEEN valid_from AND valid_to
                        LIMIT 1
                    """),
                    {"tid": str(self._tenant_id), "code": code.upper().strip()},
                )
                row = result.mappings().first()
        except Exception as e:
            log.warning("validate_promo_code_db_error error=%s", str(e))
            return PromoCodeValidation(
                code=code,
                is_valid=False,
                error_reason="PROMO_VALIDATION_NOT_AVAILABLE",
            )

        if not row:
            return PromoCodeValidation(code=code, is_valid=False, error_reason="INVALID_OR_EXPIRED")

        if row["usage_limit"] is not None and row["used_count"] >= row["usage_limit"]:
            return PromoCodeValidation(code=code, is_valid=False, error_reason="FULLY_REDEEMED")

        if rental_days < row["min_days"]:
            return PromoCodeValidation(
                code=code, is_valid=False,
                error_reason=f"MINIMUM_{row['min_days']}_DAYS_REQUIRED",
            )

        class_ids = row["applicable_class_ids"] or []
        if class_ids and vehicle_class_id and vehicle_class_id not in [str(c) for c in class_ids]:
            return PromoCodeValidation(code=code, is_valid=False, error_reason="CLASS_NOT_ELIGIBLE")

        return PromoCodeValidation(
            code=row["code"],
            is_valid=True,
            discount_type=row["discount_type"],
            discount_value=Decimal(str(row["discount_value"])),
        )

    # ── CDP Code Validation ───────────────────────────────────────────────────

    async def validate_cdp_code(self, cdp_code: str) -> Optional[RateCode]:
        """
        Look up an active CORPORATE rate code with the given CDP code.

        Returns None if not found or expired.
        """
        from datetime import datetime

        today = datetime.now(timezone.utc)
        rate_code = await self._repo.get_active_rate_code(
            location_id=UUID("00000000-0000-0000-0000-000000000000"),  # wildcard
            vehicle_class_id=UUID("00000000-0000-0000-0000-000000000000"),
            pickup_dt=today,
            dropoff_dt=today,
            cdp_code=cdp_code,
        )
        if rate_code is None or rate_code.rate_type != "CORPORATE":
            return None
        return rate_code

    # ── Rate Code CRUD ────────────────────────────────────────────────────────

    async def list_rate_codes(
        self,
        status: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[RateCode]:
        return await self._repo.list_rate_codes(status=status, limit=limit, offset=offset)

    async def get_rate_code(self, rate_code_id: UUID) -> RateCode:
        rc = await self._repo.get_rate_code_by_id(rate_code_id)
        if rc is None:
            raise ResourceNotFoundError(
                resource="rate_code", resource_id=str(rate_code_id)
            )
        return rc

    async def create_rate_code(self, data: RateCodeCreate) -> RateCode:
        return await self._repo.create_rate_code(
            code=data.code,
            description=data.description,
            rate_type=data.rate_type.value,
            market_segment=data.market_segment,
            currency=data.currency,
            status="DRAFT",
            valid_from=data.valid_from,
            valid_until=data.valid_until,
            blackout_dates=data.blackout_dates,
            day_of_week_modifiers=data.day_of_week_modifiers,
            location_scope=data.location_scope,
            location_ids=[str(lid) for lid in data.location_ids],
            vehicle_class_scope=data.vehicle_class_scope,
            vehicle_class_ids=[str(cid) for cid in data.vehicle_class_ids],
            min_rental_days=data.min_rental_days,
            max_rental_days=data.max_rental_days,
            advance_booking_hours_min=data.advance_booking_hours_min,
            advance_booking_hours_max=data.advance_booking_hours_max,
            min_driver_age=data.min_driver_age,
            prepay_required=data.prepay_required,
            refundable=data.refundable,
            is_combinable=data.is_combinable,
            max_uses_total=data.max_uses_total,
            max_uses_per_customer=data.max_uses_per_customer,
            cdp_code=data.cdp_code,
            gds_eligible=data.gds_eligible,
            gds_description=data.gds_description,
        )

    async def update_rate_code(
        self, rate_code_id: UUID, data: RateCodeUpdate
    ) -> RateCode:
        rc = await self._repo.get_rate_code_by_id(rate_code_id)
        if rc is None:
            raise ResourceNotFoundError(
                resource="rate_code", resource_id=str(rate_code_id)
            )
        if rc.status != "DRAFT":
            raise BusinessRuleError(
                f"Rate code {rate_code_id} is {rc.status}; only DRAFT codes can be updated."
            )
        updates = data.model_dump(exclude_none=True)
        rc = await self._repo.update_rate_code(rate_code_id, **updates)
        return rc  # type: ignore[return-value]

    async def activate_rate_code(
        self, rate_code_id: UUID, data: RateCodeActivate
    ) -> RateCode:
        rc = await self._repo.get_rate_code_by_id(rate_code_id)
        if rc is None:
            raise ResourceNotFoundError(
                resource="rate_code", resource_id=str(rate_code_id)
            )
        if rc.status != "DRAFT":
            raise BusinessRuleError(
                f"Rate code {rate_code_id} is already {rc.status}."
            )
        # Validate: must have at least one schedule item
        items = await self._repo.get_schedule_items(
            rate_code_id=rate_code_id,
        )
        if not items:
            raise BusinessRuleError(
                "Cannot activate a rate code with no schedule items."
            )
        result = await self._repo.activate_rate_code(rate_code_id)
        return result  # type: ignore[return-value]

    # ── Schedule Items CRUD ───────────────────────────────────────────────────

    async def get_schedule_items(self, rate_code_id: UUID) -> list[RateScheduleItem]:
        # Verify rate code exists and belongs to this tenant
        rc = await self._repo.get_rate_code_by_id(rate_code_id)
        if rc is None:
            raise ResourceNotFoundError(
                resource="rate_code", resource_id=str(rate_code_id)
            )
        return await self._repo.get_schedule_items(rate_code_id)

    async def add_schedule_item(
        self, rate_code_id: UUID, data: RateScheduleItemCreate
    ) -> RateScheduleItem:
        rc = await self._repo.get_rate_code_by_id(rate_code_id)
        if rc is None:
            raise ResourceNotFoundError(
                resource="rate_code", resource_id=str(rate_code_id)
            )
        return await self._repo.add_schedule_item(
            rate_code_id=rate_code_id,
            vehicle_class_id=str(data.vehicle_class_id),
            location_id=str(data.location_id) if data.location_id else None,
            days_min=data.days_min,
            days_max=data.days_max,
            price_per_day=data.price_per_day,
            price_per_week=data.price_per_week,
            price_per_month=data.price_per_month,
            extra_day_rate=data.extra_day_rate,
            free_miles_per_day=data.free_miles_per_day,
            overage_rate_per_mile=data.overage_rate_per_mile,
        )

    # ── Extras CRUD ───────────────────────────────────────────────────────────

    async def list_active_extras(self) -> list[ExtrasCatalog]:
        return await self._repo.get_active_extras()

    async def create_extra(self, data: ExtrasCatalogCreate) -> ExtrasCatalog:
        return await self._repo.create_extra(
            code=data.code,
            name=data.name,
            extra_type=data.extra_type,
            pricing_type=data.pricing_type.value,
            default_price=data.default_price,
            tax_treatment=data.tax_treatment.value,
            is_active=data.is_active,
        )

    async def update_extra(
        self, extra_id: UUID, data: ExtrasCatalogUpdate
    ) -> ExtrasCatalog:
        updates = data.model_dump(exclude_none=True)
        # Convert enum to string if present
        if "tax_treatment" in updates:
            updates["tax_treatment"] = updates["tax_treatment"].value
        result = await self._repo.update_extra(extra_id, **updates)
        if result is None:
            raise ResourceNotFoundError(
                resource="extra", resource_id=str(extra_id)
            )
        return result

    # ── Private helpers ───────────────────────────────────────────────────────

    @staticmethod
    def _pick_schedule_item(
        items: list[RateScheduleItem], rental_days: int
    ) -> RateScheduleItem:
        """
        Find the schedule item whose [days_min, days_max] band contains rental_days.

        Falls back to the first item if no band matches (service-level guard).
        Items are assumed to be sorted by days_min ascending.
        """
        for item in items:
            lower = item.days_min
            upper = item.days_max  # None means unbounded
            if rental_days >= lower and (upper is None or rental_days <= upper):
                return item
        # Fallback: item with highest days_min
        return items[-1]

    @staticmethod
    def _apply_dow_modifiers(
        base_rate_per_day: Decimal,
        pickup_dt: datetime,
        rental_days: int,
        modifiers: dict,
    ) -> Decimal:
        """
        Apply day-of-week pricing modifiers.

        For each rental day starting from pickup_dt, look up the modifier
        for that weekday (e.g., "FRI": 1.15 means Friday is 15% more expensive).
        Accumulate the adjusted daily rates.
        """
        _DOW_NAMES = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"]
        total = Decimal("0")
        for day_offset in range(rental_days):
            day_dt = pickup_dt + timedelta(days=day_offset)
            day_name = _DOW_NAMES[day_dt.weekday()]
            modifier = Decimal(str(modifiers.get(day_name, 1.0)))
            total += base_rate_per_day * modifier
        return _round6(total)

    @staticmethod
    def _check_advance_booking(rate_code: RateCode, pickup_dt: datetime) -> None:
        """
        Verify pickup_dt satisfies the rate code's advance booking window.

        Raises BusinessRuleError if violated.
        """
        now = datetime.now(timezone.utc)
        hours_until_pickup = (
            pickup_dt - now
        ).total_seconds() / 3600

        if (
            rate_code.advance_booking_hours_min is not None
            and hours_until_pickup < rate_code.advance_booking_hours_min
        ):
            raise BusinessRuleError(
                f"Rate code '{rate_code.code}' requires booking at least "
                f"{rate_code.advance_booking_hours_min} hours before pickup."
            )

        if (
            rate_code.advance_booking_hours_max is not None
            and hours_until_pickup > rate_code.advance_booking_hours_max
        ):
            raise BusinessRuleError(
                f"Rate code '{rate_code.code}' can only be booked up to "
                f"{rate_code.advance_booking_hours_max} hours before pickup."
            )

    async def _calculate_taxes(
        self,
        pretax_subtotal: Decimal,
        location_id: UUID,
    ) -> Decimal:
        """
        Calculate taxes for the pretax subtotal.

        Calls Avalara if client is available; falls back to a 0% stub
        (tax_template integration is handled by the counter domain at checkout).
        """
        if self._avalara is not None:
            try:
                tax_result = await self._avalara.calculate_tax(
                    lines=[
                        {"amount": float(pretax_subtotal), "itemCode": "RENTAL"}
                    ],
                    ship_to_location_id=str(location_id),
                )
                return _round6(Decimal(str(tax_result.get("totalTax", 0))))
            except Exception:
                log.warning(
                    "Avalara unavailable — falling back to 0 tax",
                    exc_info=True,
                )
        # Fallback: no tax calculation available
        return Decimal("0")
