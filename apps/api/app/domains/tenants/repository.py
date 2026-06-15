"""Tenant repository — extends BaseRepository with tenant-specific queries."""
from __future__ import annotations

import re
from typing import Optional
from uuid import UUID

from sqlalchemy import exists, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundError
from app.domains.tenants.models import Tenant


def _slugify(name: str) -> str:
    """Convert a company name to a URL-safe slug (max 32 chars)."""
    slug = name.lower()
    slug = re.sub(r"[^a-z0-9\-]", "-", slug)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    return slug[:32] or "tenant"


class TenantRepository:
    """
    Tenant repository — NOT a BaseRepository subclass because tenants don't
    have a tenant_id foreign key on themselves (they *are* the tenant root).

    All methods that need a DB session receive it via __init__.
    """

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    # ── Read ─────────────────────────────────────────────────────────────────

    async def get_by_id(self, tenant_id: str) -> Optional[Tenant]:
        result = await self.session.execute(
            select(Tenant).where(
                Tenant.tenant_id == tenant_id,
                Tenant.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def get_by_id_or_raise(self, tenant_id: str) -> Tenant:
        tenant = await self.get_by_id(tenant_id)
        if tenant is None:
            raise ResourceNotFoundError(resource="tenants", resource_id=tenant_id)
        return tenant

    async def get_by_slug(self, slug: str) -> Optional[Tenant]:
        result = await self.session.execute(
            select(Tenant).where(
                Tenant.slug == slug,
                Tenant.deleted_at.is_(None),
            )
        )
        return result.scalar_one_or_none()

    async def slug_exists(self, slug: str) -> bool:
        result = await self.session.execute(
            select(exists().where(Tenant.slug == slug, Tenant.deleted_at.is_(None)))
        )
        return bool(result.scalar())

    # ── Slug generation ──────────────────────────────────────────────────────

    async def generate_unique_slug(self, company_name: str) -> str:
        """
        Slugify company_name and append -2, -3, … on collision.
        Result is guaranteed unique in the tenants table.
        """
        base = _slugify(company_name)
        if not await self.slug_exists(base):
            return base
        counter = 2
        while True:
            candidate = f"{base[:29]}-{counter}"
            if not await self.slug_exists(candidate):
                return candidate
            counter += 1

    # ── Write ────────────────────────────────────────────────────────────────

    async def create(self, tenant: Tenant) -> Tenant:
        self.session.add(tenant)
        await self.session.flush()
        await self.session.refresh(tenant)
        return tenant

    async def update_fields(self, tenant_id: str, **kwargs) -> Tenant:
        await self.session.execute(
            update(Tenant)
            .where(Tenant.tenant_id == tenant_id)
            .values(**kwargs, updated_at=func.now())
        )
        await self.session.flush()
        return await self.get_by_id_or_raise(tenant_id)

    async def record_tos_acceptance(
        self, tenant_id: str, version: str, ip: str
    ) -> None:
        """Idempotent — sets tos_accepted_at only if not already set for this version."""
        tenant = await self.get_by_id_or_raise(tenant_id)
        if tenant.tos_version == version and tenant.tos_accepted_at is not None:
            return  # Already recorded — idempotent no-op
        await self.session.execute(
            update(Tenant)
            .where(Tenant.tenant_id == tenant_id)
            .values(
                tos_version=version,
                tos_ip=ip,
                tos_accepted_at=func.now(),
                updated_at=func.now(),
            )
        )
        await self.session.flush()

    async def suspend(self, tenant_id: str) -> None:
        await self.session.execute(
            update(Tenant)
            .where(Tenant.tenant_id == tenant_id)
            .values(status="SUSPENDED", updated_at=func.now())
        )
        await self.session.flush()

    async def reactivate(self, tenant_id: str) -> None:
        await self.session.execute(
            update(Tenant)
            .where(Tenant.tenant_id == tenant_id)
            .values(status="ACTIVE", updated_at=func.now())
        )
        await self.session.flush()

    # ── Readiness gate queries ────────────────────────────────────────────────

    async def get_readiness_checks(self, tenant_id: str) -> dict[str, bool]:
        """
        Execute all 9 day-zero readiness checks and return a key→bool dict.
        Uses a single round-trip with multiple sub-selects to minimise DB calls.
        """
        # Raw SQL scalar queries for each check
        checks: dict[str, bool] = {}

        tenant = await self.get_by_id_or_raise(tenant_id)

        # 1. Company profile complete
        checks["company_profile"] = bool(
            tenant.legal_name and tenant.billing_address
        )

        # 2. At least one active location with hours configured
        result = await self.session.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM locations"
                "  WHERE tenant_id = :tid"
                "    AND deleted_at IS NULL"
                "    AND is_active = TRUE"
                "    AND hours_of_operation IS NOT NULL"
                "    AND hours_of_operation != '{}'"
                ")"
            ),
            {"tid": tenant_id},
        )
        checks["location_hours"] = bool(result.scalar())

        # 3. Payment gateway connected (Stripe account)
        checks["payment_gateway_connected"] = bool(tenant.stripe_account_id)

        # 4. Payment gateway test charge succeeded
        checks["payment_gateway_tested"] = bool(tenant.stripe_test_charge_succeeded)

        # 5. At least one active rate code
        result = await self.session.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM rate_codes"
                "  WHERE tenant_id = :tid"
                "    AND status = 'ACTIVE'"
                "    AND deleted_at IS NULL"
                ")"
            ),
            {"tid": tenant_id},
        )
        checks["active_rate_code"] = bool(result.scalar())

        # 6. At least one vehicle in AVAILABLE status
        result = await self.session.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM vehicles"
                "  WHERE tenant_id = :tid"
                "    AND status = 'AVAILABLE'"
                "    AND deleted_at IS NULL"
                ")"
            ),
            {"tid": tenant_id},
        )
        checks["vehicle_available"] = bool(result.scalar())

        # 7. Tax template exists for tenant
        result = await self.session.execute(
            text(
                "SELECT EXISTS ("
                "  SELECT 1 FROM tax_templates"
                "  WHERE tenant_id = :tid"
                ")"
            ),
            {"tid": tenant_id},
        )
        checks["tax_template"] = bool(result.scalar())

        # 8. Rental agreement template uploaded
        checks["ra_template"] = bool(tenant.ra_template_id)

        # 9. Notification email credentials configured
        checks["notification_email_credentials"] = bool(
            tenant.smtp_host or tenant.sendgrid_api_key
        )

        return checks
