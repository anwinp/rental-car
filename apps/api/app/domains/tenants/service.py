"""Tenant service — business logic for tenant provisioning and management."""
from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    ResourceNotFoundError,
)
from app.domains.tenants.models import Tenant
from app.domains.tenants.repository import TenantRepository
from app.domains.tenants.schemas import (
    ReadinessCheck,
    ReadinessGateStatus,
    StaffUserCreate,
    TenantCreate,
    TenantUpdate,
)

# ── Readiness-gate metadata ──────────────────────────────────────────────────

_READINESS_META: list[dict] = [
    {
        "key": "company_profile",
        "label": "Company profile complete",
        "action_url": "/settings/company",
    },
    {
        "key": "location_hours",
        "label": "At least one active location with hours",
        "action_url": "/settings/locations",
    },
    {
        "key": "payment_gateway_connected",
        "label": "Payment gateway connected (Stripe)",
        "action_url": "/settings/payments",
    },
    {
        "key": "payment_gateway_tested",
        "label": "Payment gateway test charge succeeded",
        "action_url": "/settings/payments/test",
    },
    {
        "key": "active_rate_code",
        "label": "At least one active rate code",
        "action_url": "/settings/rates",
    },
    {
        "key": "vehicle_available",
        "label": "At least one vehicle in AVAILABLE status",
        "action_url": "/fleet",
    },
    {
        "key": "tax_template",
        "label": "Tax template assigned to tenant",
        "action_url": "/settings/taxes",
    },
    {
        "key": "ra_template",
        "label": "Rental agreement template uploaded",
        "action_url": "/settings/documents",
    },
    {
        "key": "notification_email_credentials",
        "label": "Notification email credentials configured",
        "action_url": "/settings/notifications",
    },
]

assert len(_READINESS_META) == 9, "Must have exactly 9 readiness checks (GAP-001)"


class TenantService:
    """
    All public methods accept a `session` parameter so callers control the
    transaction boundary. No session stored on the instance — this keeps the
    service stateless and testable.
    """

    # ── Tenant provisioning ──────────────────────────────────────────────────

    async def create_tenant(
        self,
        session: AsyncSession,
        data: TenantCreate,
        first_admin: StaffUserCreate,
    ) -> Tenant:
        """
        Atomic: create tenant + first SUPER_ADMIN staff user in one transaction.
        Raises ConflictError if slug is already taken.
        """
        repo = TenantRepository(session)

        # Resolve slug (auto-generate if omitted)
        slug = data.slug or await repo.generate_unique_slug(data.company_name)
        if data.slug and await repo.slug_exists(slug):
            raise ConflictError(
                f"Slug '{slug}' is already taken. Choose a different slug.",
                extra={"slug": slug, "error_code": "TENANT_SLUG_TAKEN"},
            )

        tenant = Tenant(
            tenant_id=str(uuid.uuid4()),
            slug=slug,
            legal_name=data.company_name,
            primary_email=data.primary_email,
            primary_phone=data.primary_phone,
            default_currency=data.currency,
            default_timezone=data.timezone,
            subscription_tier=data.subscription_tier,
            status="ACTIVE",
            billing_address={},
        )
        tenant = await repo.create(tenant)

        # Create first SUPER_ADMIN user (import here to avoid circular import)
        await self._create_first_admin(session, tenant.tenant_id, first_admin)

        return tenant

    async def _create_first_admin(
        self,
        session: AsyncSession,
        tenant_id: str,
        admin_data: StaffUserCreate,
    ) -> None:
        """Insert the first SUPER_ADMIN staff user for a newly provisioned tenant."""
        from app.core.security import hash_password
        from sqlalchemy import text

        user_id = str(uuid.uuid4())
        password_hash = hash_password(admin_data.password)

        await session.execute(
            text(
                "INSERT INTO staff_users "
                "(user_id, tenant_id, email, password_hash, first_name, last_name, role) "
                "VALUES (:uid, :tid, :email, :ph, :fn, :ln, 'SUPER_ADMIN')"
            ),
            {
                "uid": user_id,
                "tid": tenant_id,
                "email": admin_data.email,
                "ph": password_hash,
                "fn": admin_data.first_name,
                "ln": admin_data.last_name,
            },
        )

    # ── Readiness gate ────────────────────────────────────────────────────────

    async def get_readiness_gate(
        self, session: AsyncSession, tenant_id: str
    ) -> ReadinessGateStatus:
        """
        Run all 9 day-zero readiness checks (GAP-001).
        Returns ReadinessGateStatus with exactly 9 checks.
        """
        repo = TenantRepository(session)
        results: dict[str, bool] = await repo.get_readiness_checks(tenant_id)

        checks: list[ReadinessCheck] = [
            ReadinessCheck(
                key=meta["key"],
                label=meta["label"],
                is_complete=results.get(meta["key"], False),
                action_url=meta.get("action_url"),
            )
            for meta in _READINESS_META
        ]

        assert len(checks) == 9

        return ReadinessGateStatus(
            tenant_id=tenant_id,
            all_passed=all(c.is_complete for c in checks),
            checks=checks,
        )

    # ── CRUD helpers ──────────────────────────────────────────────────────────

    async def get_tenant(
        self, session: AsyncSession, tenant_id: str
    ) -> Tenant:
        repo = TenantRepository(session)
        return await repo.get_by_id_or_raise(tenant_id)

    async def update_tenant(
        self,
        session: AsyncSession,
        tenant_id: str,
        data: TenantUpdate,
    ) -> Tenant:
        repo = TenantRepository(session)
        updates: dict = data.model_dump(exclude_none=True)
        if not updates:
            return await repo.get_by_id_or_raise(tenant_id)

        # Map schema field names to DB column names where they differ
        if "company_name" in updates:
            updates["legal_name"] = updates.pop("company_name")
        if "currency" in updates:
            updates["default_currency"] = updates.pop("currency")
        if "timezone" in updates:
            updates["default_timezone"] = updates.pop("timezone")

        return await repo.update_fields(tenant_id, **updates)

    # ── Suspension & ToS ──────────────────────────────────────────────────────

    async def suspend_tenant(
        self, session: AsyncSession, tenant_id: str
    ) -> None:
        """Set is_active=False (status=SUSPENDED). Downstream session invalidation
        is handled by the caller (Redis key deletion)."""
        repo = TenantRepository(session)
        await repo.get_by_id_or_raise(tenant_id)  # 404 guard
        await repo.suspend(tenant_id)

    async def accept_tos(
        self,
        session: AsyncSession,
        tenant_id: str,
        ip: str,
        version: str,
    ) -> None:
        """
        Record Terms of Service acceptance.
        Idempotent — re-accepting the same version is a no-op.
        """
        repo = TenantRepository(session)
        await repo.record_tos_acceptance(tenant_id, version, ip)
