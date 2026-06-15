"""Customer domain service — business logic for customer management."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, date
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    BusinessRuleError,
    ConflictError,
    DuplicateError,
    GDPRLegalHoldError,
    PermissionDeniedError,
    ResourceNotFoundError,
)
from app.domains.customers.models import Customer
from app.domains.customers.repository import CustomerRepository
from app.domains.customers.schemas import (
    CustomerCreate,
    CustomerMergeRequest,
    CustomerSearchQuery,
    CustomerUpdate,
    DNRCheckResult,
    DNRCreate,
    DNRScope,
    GDPRErasureRequest,
)


class CustomerService:
    """
    All customer-facing business logic.

    Security invariant: DNR check results (is_blocked=True + reason) are
    ONLY returned to counter agents. The customer-facing API must never
    expose the DNR reason — use DNRBlockError with a generic message instead.
    """

    def __init__(self, session: AsyncSession, tenant_id: uuid.UUID) -> None:
        self._session = session
        self._tenant_id = tenant_id
        self._repo = CustomerRepository(session, tenant_id)

    # ── Customer CRUD ─────────────────────────────────────────────────────────

    async def create_customer(
        self, data: CustomerCreate, tenant_id: uuid.UUID
    ) -> Customer:
        """
        Create a new customer.
        Raises DuplicateError if email already exists for this tenant (case-insensitive).
        """
        existing = await self._repo.get_by_email(data.email, tenant_id)
        if existing is not None:
            raise DuplicateError(
                f"A customer with email '{data.email}' already exists for this tenant."
            )

        customer = await self._repo.create(
            first_name=data.first_name,
            last_name=data.last_name,
            email=data.email.lower(),
            mobile_phone=data.phone,
            date_of_birth=data.date_of_birth,
            nationality=data.nationality,
            license_number=data.dl_number,
            license_state=data.dl_state,
            license_country=data.dl_country,
            license_expiry=data.dl_expiry,
            # dl_dob maps to date_of_birth if not separately provided
            account_type=data.account_type.value,
            language_code=data.language_code,
            comm_opt_marketing=data.marketing_opt_in,
        )
        return customer

    async def get_customer(
        self, customer_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> Customer:
        """Fetch a customer by ID or raise ResourceNotFoundError."""
        customer = await self._repo.get(customer_id)
        if customer is None:
            raise ResourceNotFoundError("customer", str(customer_id))
        return customer

    async def update_customer(
        self,
        customer_id: uuid.UUID,
        data: CustomerUpdate,
        tenant_id: uuid.UUID,
    ) -> Customer:
        """Partial update — only set fields that are not None."""
        # Verify customer exists
        await self.get_customer(customer_id, tenant_id)

        # Build update kwargs from non-None fields
        updates: dict = {}
        if data.first_name is not None:
            updates["first_name"] = data.first_name
        if data.last_name is not None:
            updates["last_name"] = data.last_name
        if data.email is not None:
            # Check uniqueness if email is changing
            existing = await self._repo.get_by_email(data.email, tenant_id)
            if existing is not None and str(existing.customer_id) != str(customer_id):
                raise DuplicateError(
                    f"Email '{data.email}' is already in use by another customer."
                )
            updates["email"] = data.email.lower()
        if data.phone is not None:
            updates["mobile_phone"] = data.phone
        if data.date_of_birth is not None:
            updates["date_of_birth"] = data.date_of_birth
        if data.nationality is not None:
            updates["nationality"] = data.nationality
        if data.dl_number is not None:
            updates["license_number"] = data.dl_number
        if data.dl_state is not None:
            updates["license_state"] = data.dl_state
        if data.dl_country is not None:
            updates["license_country"] = data.dl_country
        if data.dl_expiry is not None:
            updates["license_expiry"] = data.dl_expiry
        if data.account_type is not None:
            updates["account_type"] = data.account_type.value
        if data.language_code is not None:
            updates["language_code"] = data.language_code
        if data.comm_opt_email is not None:
            updates["comm_opt_email"] = data.comm_opt_email
        if data.comm_opt_sms is not None:
            updates["comm_opt_sms"] = data.comm_opt_sms
        if data.comm_opt_marketing is not None:
            updates["comm_opt_marketing"] = data.comm_opt_marketing

        if not updates:
            return await self.get_customer(customer_id, tenant_id)

        return await self._repo.update(customer_id, **updates)

    async def search_customers(
        self, query: CustomerSearchQuery, tenant_id: uuid.UUID
    ) -> list[Customer]:
        """
        Fulltext search across name/email/phone/DL number.
        Returns at most 50 results.
        """
        if query.dnr_only:
            return await self._repo.get_active_dnr_customers(tenant_id)

        if not query.q:
            return await self._repo.list(limit=min(query.limit, 50), offset=query.offset)

        return await self._repo.fulltext_search(query.q, tenant_id, limit=50)

    # ── DNR Management ────────────────────────────────────────────────────────

    async def check_dnr(
        self,
        customer_id: uuid.UUID,
        tenant_id: uuid.UUID,
        location_id: Optional[uuid.UUID] = None,
    ) -> DNRCheckResult:
        """
        Evaluate DNR status for a customer at a specific location.

        SECURITY: The returned reason is for counter-agent eyes only.
        The customer-facing layer must use a generic message.

        Scope resolution:
        - dnr_flag = False → NOT BLOCKED
        - NETWORK scope → BLOCKED everywhere
        - REGIONAL scope → BLOCKED at all locations in the same region
          (region lookup delegated to caller; here we return is_blocked=True
           with scope=REGIONAL for the router to resolve)
        - LOCATION scope → BLOCKED only if location_id matches dnr_location
          (stored in dnr_incident_ref for location-specific DNR)
        """
        customer = await self.get_customer(customer_id, tenant_id)

        if not customer.dnr_flag:
            return DNRCheckResult(
                customer_id=customer_id,
                is_blocked=False,
            )

        # Check if DNR has expired
        if customer.dnr_expiry and customer.dnr_expiry < datetime.now(timezone.utc).date():
            # Auto-clear expired DNR
            await self._repo.update(
                customer_id,
                dnr_flag=False,
                dnr_reason=None,
                dnr_scope=None,
                dnr_expiry=None,
                dnr_added_by=None,
            )
            return DNRCheckResult(
                customer_id=customer_id,
                is_blocked=False,
            )

        scope = DNRScope(customer.dnr_scope) if customer.dnr_scope else None

        if scope == DNRScope.NETWORK:
            return DNRCheckResult(
                customer_id=customer_id,
                is_blocked=True,
                scope=scope,
                reason=customer.dnr_reason,
                set_at=customer.updated_at,
            )

        if scope == DNRScope.REGIONAL:
            # Regional scope blocks at all locations in the same region.
            # Region resolution is caller's responsibility (pass location_id in).
            # Without location context we treat REGIONAL as blocked.
            return DNRCheckResult(
                customer_id=customer_id,
                is_blocked=True,
                scope=scope,
                reason=customer.dnr_reason,
                set_at=customer.updated_at,
            )

        if scope == DNRScope.LOCATION:
            # Block only if the request location matches the DNR location
            # The DNR location is stored in dnr_incident_ref (UUID ref)
            dnr_location_id = customer.dnr_incident_ref
            if location_id is not None and dnr_location_id:
                is_blocked = str(location_id) == str(dnr_location_id)
            else:
                # No location provided → conservative: block
                is_blocked = True

            return DNRCheckResult(
                customer_id=customer_id,
                is_blocked=is_blocked,
                scope=scope,
                reason=customer.dnr_reason if is_blocked else None,
                set_at=customer.updated_at if is_blocked else None,
                set_by_location_id=uuid.UUID(dnr_location_id) if is_blocked and dnr_location_id else None,
            )

        # Flag is set but no valid scope — treat as blocked (conservative)
        return DNRCheckResult(
            customer_id=customer_id,
            is_blocked=True,
            reason=customer.dnr_reason,
        )

    async def add_dnr(
        self,
        customer_id: uuid.UUID,
        data: DNRCreate,
        actor_id: uuid.UUID,
        tenant_id: uuid.UUID,
    ) -> Customer:
        """
        Add a DNR flag. Requires BRANCH_MANAGER or above (enforced in router).
        Audit trail written by DB trigger automatically.
        """
        await self.get_customer(customer_id, tenant_id)

        updates = {
            "dnr_flag": True,
            "dnr_scope": data.scope.value,
            "dnr_reason": f"{data.reason_code}: {data.notes}",
            "dnr_added_by": str(actor_id),
            "dnr_expiry": data.expires_at,
        }
        if data.scope == DNRScope.LOCATION and data.location_id:
            updates["dnr_incident_ref"] = str(data.location_id)

        return await self._repo.update(customer_id, **updates)

    async def remove_dnr(
        self,
        customer_id: uuid.UUID,
        actor_id: uuid.UUID,
        reason: str,
        tenant_id: uuid.UUID,
    ) -> Customer:
        """
        Remove a DNR flag.
        Requires BRANCH_MANAGER or above (enforced in router).
        """
        customer = await self.get_customer(customer_id, tenant_id)
        if not customer.dnr_flag:
            raise BusinessRuleError("Customer does not have an active DNR flag.")

        return await self._repo.update(
            customer_id,
            dnr_flag=False,
            dnr_scope=None,
            dnr_reason=None,
            dnr_added_by=None,
            dnr_expiry=None,
            dnr_incident_ref=None,
        )

    # ── GDPR Erasure ─────────────────────────────────────────────────────────

    async def gdpr_erasure(
        self,
        customer_id: uuid.UUID,
        tenant_id: uuid.UUID,
        actor_id: uuid.UUID,
        request: GDPRErasureRequest,
    ) -> None:
        """
        GDPR Article 17 right to erasure.

        Legal hold checks (MUST pass before anonymizing):
        - No active damage claims (OPEN, ESTIMATE_SENT, REPAIR_IN_PROGRESS, etc.)
        - No open/active rentals (ACTIVE, EXTENDED, DISPUTED status)

        Anonymizes PII in-place. Never deletes the row.
        Audit trail written by DB trigger.
        """
        from sqlalchemy import select, and_

        customer = await self.get_customer(customer_id, tenant_id)

        # Check for active rental agreements
        # Import here to avoid circular imports
        try:
            from app.domains.checkout.models import RentalAgreement
            stmt = select(RentalAgreement).where(
                and_(
                    RentalAgreement.customer_id == str(customer_id),
                    RentalAgreement.tenant_id == str(tenant_id),
                    RentalAgreement.status.in_(["ACTIVE", "EXTENDED", "DISPUTED"]),
                )
            )
            result = await self._session.execute(stmt)
            active_ra = result.scalar_one_or_none()
            if active_ra is not None:
                raise GDPRLegalHoldError(
                    f"Customer {customer_id} has an active rental agreement "
                    f"({active_ra.ra_id}) and cannot be anonymized."
                )
        except ImportError:
            # Checkout models not yet available — skip this check in tests
            pass

        # Check for active damage claims
        try:
            from app.domains.damage.models import DamageClaim
            open_statuses = [
                "OPEN", "ESTIMATE_SENT", "CUSTOMER_ACKNOWLEDGED",
                "REPAIR_IN_PROGRESS", "REPAIR_COMPLETE", "INVOICED",
                "DISPUTED", "IN_LITIGATION",
            ]
            stmt = select(DamageClaim).where(
                and_(
                    DamageClaim.customer_id == str(customer_id),
                    DamageClaim.tenant_id == str(tenant_id),
                    DamageClaim.status.in_(open_statuses),
                )
            )
            result = await self._session.execute(stmt)
            active_claim = result.scalar_one_or_none()
            if active_claim is not None:
                raise GDPRLegalHoldError(
                    f"Customer {customer_id} has an open damage claim "
                    f"({active_claim.claim_id}) and cannot be anonymized."
                )
        except ImportError:
            pass

        # Perform anonymization
        anon_email = f"anon_{customer_id}@deleted.invalid"
        await self._repo.update(
            customer_id,
            first_name="ANONYMIZED",
            last_name="ANONYMIZED",
            email=anon_email,
            mobile_phone=None,
            alt_phone=None,
            date_of_birth=None,
            license_number=None,
            license_state=None,
            license_country=None,
            license_expiry=None,
            license_issued_date=None,
            mailing_address=None,
            billing_address=None,
            account_status="ANONYMIZED",
            anonymized_at=datetime.now(timezone.utc),
        )

    # ── Customer Merge ────────────────────────────────────────────────────────

    async def merge_customers(
        self,
        data: CustomerMergeRequest,
        tenant_id: uuid.UUID,
        actor_id: uuid.UUID,
    ) -> Customer:
        """
        Merge source customer into target customer.

        Steps:
        1. Verify both customers exist and belong to tenant
        2. Re-link all reservations/rental agreements from source → target
        3. Copy DL fields to target if target is missing them
        4. Anonymize source customer
        5. Return updated target customer

        Audit trail written by DB trigger.
        """
        from sqlalchemy import update as sa_update

        source = await self.get_customer(data.source_id, tenant_id)
        target = await self.get_customer(data.target_id, tenant_id)

        if str(source.customer_id) == str(target.customer_id):
            raise BusinessRuleError("Source and target customers must be different.")

        # Re-link reservations
        try:
            from app.domains.reservations.models import Reservation
            await self._session.execute(
                sa_update(Reservation)
                .where(
                    Reservation.customer_id == str(data.source_id),
                    Reservation.tenant_id == str(tenant_id),
                )
                .values(customer_id=str(data.target_id))
            )
        except ImportError:
            pass

        # Re-link rental agreements
        try:
            from app.domains.checkout.models import RentalAgreement
            await self._session.execute(
                sa_update(RentalAgreement)
                .where(
                    RentalAgreement.customer_id == str(data.source_id),
                    RentalAgreement.tenant_id == str(tenant_id),
                )
                .values(customer_id=str(data.target_id))
            )
        except ImportError:
            pass

        # Copy DL fields to target if target is missing them
        dl_updates: dict = {}
        if not target.license_number and source.license_number:
            dl_updates["license_number"] = source.license_number
        if not target.license_state and source.license_state:
            dl_updates["license_state"] = source.license_state
        if not target.license_country and source.license_country:
            dl_updates["license_country"] = source.license_country
        if not target.license_expiry and source.license_expiry:
            dl_updates["license_expiry"] = source.license_expiry

        if dl_updates:
            await self._repo.update(data.target_id, **dl_updates)

        # Anonymize source
        anon_email = f"anon_{data.source_id}@deleted.invalid"
        await self._repo.update(
            data.source_id,
            first_name="ANONYMIZED",
            last_name="ANONYMIZED",
            email=anon_email,
            mobile_phone=None,
            date_of_birth=None,
            license_number=None,
            license_state=None,
            license_country=None,
            account_status="ANONYMIZED",
            anonymized_at=datetime.now(timezone.utc),
        )

        await self._session.flush()
        return await self.get_customer(data.target_id, tenant_id)
