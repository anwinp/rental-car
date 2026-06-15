"""Payments domain repository — data access for Payment and ProcessedWebhook."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_, insert, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domains.payments.models import Payment, ProcessedWebhook


class PaymentRepository:
    """Tenant-scoped data access for payments and webhook idempotency."""

    def __init__(self, session: AsyncSession, tenant_id: str) -> None:
        self._session = session
        self._tenant_id = tenant_id

    def _tenant_filter(self):
        return Payment.tenant_id == self._tenant_id

    # ── Payment CRUD ──────────────────────────────────────────────────────────

    async def create(self, **kwargs) -> Payment:
        payment = Payment(
            payment_id=str(uuid.uuid4()),
            tenant_id=self._tenant_id,
            **kwargs,
        )
        self._session.add(payment)
        await self._session.flush()
        await self._session.refresh(payment)
        return payment

    async def get_by_id(self, payment_id: str) -> Optional[Payment]:
        result = await self._session.execute(
            select(Payment).where(
                and_(
                    Payment.payment_id == payment_id,
                    self._tenant_filter(),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_by_gateway_payment_id(self, gateway_payment_id: str) -> Optional[Payment]:
        result = await self._session.execute(
            select(Payment).where(
                and_(
                    Payment.gateway_payment_id == gateway_payment_id,
                    self._tenant_filter(),
                )
            )
        )
        return result.scalar_one_or_none()

    async def get_authorized_for_reservation(
        self, reservation_id: str
    ) -> Optional[Payment]:
        """Find an AUTHORIZED pre-auth payment for a reservation."""
        result = await self._session.execute(
            select(Payment).where(
                and_(
                    Payment.reservation_id == reservation_id,
                    Payment.status == "AUTHORIZED",
                    Payment.payment_type == "PREAUTH",
                    self._tenant_filter(),
                )
            )
        )
        return result.scalar_one_or_none()

    async def list_by_rental(self, rental_agreement_id: str) -> list[Payment]:
        result = await self._session.execute(
            select(Payment)
            .where(
                and_(
                    Payment.rental_agreement_id == rental_agreement_id,
                    self._tenant_filter(),
                )
            )
            .order_by(Payment.created_at.desc())
        )
        return list(result.scalars().all())

    async def list_by_reservation(self, reservation_id: str) -> list[Payment]:
        result = await self._session.execute(
            select(Payment)
            .where(
                and_(
                    Payment.reservation_id == reservation_id,
                    self._tenant_filter(),
                )
            )
            .order_by(Payment.created_at.desc())
        )
        return list(result.scalars().all())

    async def update(self, payment_id: str, **kwargs) -> None:
        await self._session.execute(
            update(Payment)
            .where(
                and_(Payment.payment_id == payment_id, self._tenant_filter())
            )
            .values(**kwargs, updated_at=datetime.now(timezone.utc))
        )
        await self._session.flush()

    async def list_expiring_pre_auths(self, within_hours: int) -> list[Payment]:
        """
        Return AUTHORIZED pre-auths expiring within `within_hours` hours.
        Used by the Celery renewal task.
        """
        from sqlalchemy import func, text
        cutoff_expr = text(f"NOW() + INTERVAL '{within_hours} hours'")
        result = await self._session.execute(
            select(Payment).where(
                and_(
                    Payment.status == "AUTHORIZED",
                    Payment.payment_type == "PREAUTH",
                    Payment.auth_expiry_at.isnot(None),
                    Payment.auth_expiry_at <= cutoff_expr,
                )
            )
        )
        return list(result.scalars().all())

    # ── Webhook idempotency ───────────────────────────────────────────────────

    async def mark_webhook_processed(self, event_id: str, gateway: str = "STRIPE") -> bool:
        """
        INSERT INTO processed_webhooks.
        Returns True if inserted (first time), False if duplicate (already processed).
        MUST be called within the same transaction as the domain handler.
        """
        try:
            await self._session.execute(
                insert(ProcessedWebhook).values(
                    event_id=event_id,
                    gateway=gateway,
                    processed_at=datetime.now(timezone.utc),
                )
            )
            await self._session.flush()
            return True
        except IntegrityError:
            # Unique violation on event_id → already processed
            await self._session.rollback()
            return False

    async def is_webhook_processed(self, event_id: str) -> bool:
        result = await self._session.execute(
            select(ProcessedWebhook).where(ProcessedWebhook.event_id == event_id)
        )
        return result.scalar_one_or_none() is not None
