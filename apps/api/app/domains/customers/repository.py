"""Customer repository — extends BaseRepository with customer-specific queries."""
from __future__ import annotations

import uuid
from typing import Optional

from sqlalchemy import func, or_, select, text

from app.core.repository import BaseRepository
from app.domains.customers.models import Customer


class CustomerRepository(BaseRepository[Customer]):
    model = Customer

    async def get_by_email(
        self, email: str, tenant_id: uuid.UUID
    ) -> Optional[Customer]:
        """Case-insensitive email lookup scoped to tenant."""
        result = await self.session.execute(
            select(Customer).where(
                Customer.tenant_id == str(tenant_id),
                func.lower(Customer.email) == email.lower(),
                Customer.deleted_at.is_(None),
                Customer.anonymized_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def fulltext_search(
        self, query: str, tenant_id: uuid.UUID, limit: int = 50
    ) -> list[Customer]:
        """
        PostgreSQL fulltext search across name/email/phone, plus exact DL match.

        Uses the GIN index idx_customers_fulltext when available.
        Falls back to ILIKE for short queries that don't benefit from tsvector.
        """
        ts_query = func.plainto_tsquery("english", query)
        ts_vector = func.to_tsvector(
            "english",
            func.coalesce(Customer.first_name, "")
            + " "
            + func.coalesce(Customer.last_name, "")
            + " "
            + func.coalesce(Customer.email, "")
            + " "
            + func.coalesce(Customer.mobile_phone, ""),
        )

        stmt = (
            select(Customer)
            .where(
                Customer.tenant_id == str(tenant_id),
                Customer.deleted_at.is_(None),
                Customer.anonymized_at.is_(None),
                or_(
                    ts_vector.op("@@")(ts_query),
                    # Exact DL number match as secondary path
                    Customer.license_number == query,
                ),
            )
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_google_sub(
        self, google_sub: str, tenant_id: uuid.UUID
    ) -> Optional[Customer]:
        """Look up a customer by their Google OAuth subject identifier."""
        result = await self.session.execute(
            select(Customer).where(
                Customer.tenant_id == str(tenant_id),
                Customer.oauth_google_sub == google_sub,
                Customer.deleted_at.is_(None),
                Customer.anonymized_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_active_dnr_customers(
        self, tenant_id: uuid.UUID
    ) -> list[Customer]:
        """Return all customers with an active DNR flag for this tenant."""
        result = await self.session.execute(
            select(Customer).where(
                Customer.tenant_id == str(tenant_id),
                Customer.dnr_flag.is_(True),
                Customer.deleted_at.is_(None),
            )
        )
        return list(result.scalars().all())

    async def get_by_license(
        self, license_number: str, license_state: Optional[str], tenant_id: uuid.UUID
    ) -> Optional[Customer]:
        """Exact DL number match for deduplication."""
        conditions = [
            Customer.tenant_id == str(tenant_id),
            Customer.license_number == license_number,
            Customer.deleted_at.is_(None),
        ]
        if license_state:
            conditions.append(Customer.license_state == license_state)

        result = await self.session.execute(select(Customer).where(*conditions))
        return result.scalar_one_or_none()
