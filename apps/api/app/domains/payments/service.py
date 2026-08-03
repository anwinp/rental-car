"""
Payments domain service — pre-auth, capture, refund, void, webhook handling.

Critical invariants:
  * All monetary amounts use Python Decimal — never float.
  * ProcessedWebhook INSERT and domain handler run in the SAME DB transaction.
  * No raw card numbers, CVV, or PANs are ever stored — only last4/brand/expiry.
  * Refunds > $500 (50000 cents) route to approval queue (requires_approval=True).
"""
from __future__ import annotations

import structlog
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictError,
    ResourceNotFoundError,
    StripeError,
    ValidationError,
)
from app.core.redis import PREAUTH_LOCK_KEY, get_session_redis
from app.domains.payments.models import Payment
from app.domains.payments.repository import PaymentRepository
from app.domains.payments.schemas import (
    CaptureRequest,
    CaptureResponse,
    GLJournalEntry,
    InitiatePreAuthRequest,
    PaymentResponse,
    PreAuthResponse,
    RefundRequest,
    VoidRequest,
    WebhookEvent,
)
from app.domains.payments.gateway import PaymentGateway

log = structlog.get_logger()

_REFUND_APPROVAL_THRESHOLD_CENTS = 50000  # $500.00 USD
_PRE_AUTH_EXPIRY_DAYS = 7
_MIN_CAPTURE_AMOUNT = Decimal("0.50")


class PaymentService:
    """
    Orchestrates gateway calls with local Payment record management.

    The gateway is resolved per tenant through `gateway_factory`, which is also
    where its credentials come from — this class never sees an API key and must
    not acquire one, so that whose money is moving stays a property of the
    resolved gateway rather than of ambient process state.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._gateway: PaymentGateway | None = None
        self._tenant_id: str = ""

    async def _get_gateway(self) -> PaymentGateway:
        if self._gateway is None:
            from app.domains.payments.gateway_factory import get_gateway_for_tenant
            self._gateway = await get_gateway_for_tenant(self._tenant_id, self._session)
        return self._gateway

    def _get_repo(self, tenant_id: str) -> PaymentRepository:
        return PaymentRepository(self._session, tenant_id)

    # ── Pre-Authorization ────────────────────────────────────────────────────

    async def initiate_pre_auth(
        self, data: InitiatePreAuthRequest, tenant_id: str
    ) -> PreAuthResponse:
        """
        Create a Stripe PaymentIntent with capture_method='manual' (hold only).
        Store Payment row with status=AUTHORIZED.
        """
        self._tenant_id = tenant_id
        repo = self._get_repo(tenant_id)

        import uuid as _uuid
        gw = await self._get_gateway()
        preauth_result = await gw.create_preauth(
            amount=data.deposit_amount,
            currency=data.currency,
            customer_ref=str(data.customer_id),
            payment_method_token=data.payment_method_id,
            idempotency_key=str(_uuid.uuid4()),
            metadata={
                "reservation_id": str(data.reservation_id),
                "tenant_id": tenant_id,
                "customer_id": str(data.customer_id),
            },
        )
        # Build a minimal intent-like dict for downstream compatibility
        intent = {
            "id": preauth_result.gateway_payment_id,
            "client_secret": None,
            "payment_method_details": {},
        }

        auth_expiry_at = datetime.now(timezone.utc) + timedelta(days=_PRE_AUTH_EXPIRY_DAYS)

        payment = await repo.create(
            reservation_id=str(data.reservation_id),
            payment_type="PREAUTH",
            payment_method="CREDIT_CARD",
            status="AUTHORIZED",
            amount=data.deposit_amount,
            currency=data.currency.upper(),
            gateway="STRIPE",
            gateway_payment_id=intent.get("id", ""),
            card_last4=intent.get("payment_method_details", {}).get("card", {}).get("last4"),
            card_brand=intent.get("payment_method_details", {}).get("card", {}).get("brand"),
            card_expiry_month=intent.get("payment_method_details", {}).get("card", {}).get("exp_month"),
            card_expiry_year=intent.get("payment_method_details", {}).get("card", {}).get("exp_year"),
            authorized_at=datetime.now(timezone.utc),
            auth_expiry_at=auth_expiry_at,
        )

        # Post memo GL entry: Dr Deposit Receivable / Cr Pre-auth Memo
        await self._post_gl_entry(
            GLJournalEntry(
                entry_type="MEMO",
                debit_account="1200-DEPOSIT-RECEIVABLE",
                credit_account="2100-PREAUTH-MEMO",
                amount=data.deposit_amount,
                description=f"Pre-auth hold for reservation {data.reservation_id}",
                reference_id=payment.payment_id,
            )
        )

        await self._session.commit()

        return PreAuthResponse(
            payment_id=UUID(payment.payment_id),
            stripe_payment_intent_id=intent.get("id", ""),
            client_secret=intent.get("client_secret"),
            status="AUTHORIZED",  # type: ignore[arg-type]
            amount_authorized=data.deposit_amount,
            currency=data.currency.upper(),
            auth_expiry_at=auth_expiry_at,
        )

    # ── Capture ───────────────────────────────────────────────────────────────

    async def capture_payment(
        self, data: CaptureRequest, tenant_id: str
    ) -> CaptureResponse:
        """
        Calculate final total, capture against Stripe, update Payment record,
        post GL entries, queue receipt notification.
        """
        self._tenant_id = tenant_id
        repo = self._get_repo(tenant_id)
        payment = await repo.get_by_id(str(data.payment_id))
        if payment is None:
            raise ResourceNotFoundError("payments", str(data.payment_id))
        if payment.status != "AUTHORIZED":
            raise ConflictError(
                f"Payment {data.payment_id} has status '{payment.status}'; "
                "only AUTHORIZED payments can be captured."
            )

        # Capture formula (§6.5)
        raw_total = (
            data.base_rental_amount
            + data.extras_amount
            + data.time_extension_amount
            + data.fuel_charge_amount
            + data.mileage_overage_amount
            + data.damage_charge_amount
            - data.deposit_already_paid
        )
        capture_amount = raw_total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        # Enforce minimum Stripe capture
        capture_amount = max(capture_amount, _MIN_CAPTURE_AMOUNT)

        amount_cents = int(capture_amount * 100)
        authorized_cents = int(payment.amount * 100)

        import uuid as _uuid
        gw = await self._get_gateway()

        # If capture exceeds authorized amount, perform incremental auth first
        if amount_cents > authorized_cents:
            incr_result = await gw.incremental_auth(
                preauth_id=payment.gateway_payment_id,
                new_total_amount=capture_amount,
                idempotency_key=str(_uuid.uuid4()),
            )
            await repo.update(
                payment.payment_id,
                network_txn_id=incr_result.gateway_auth_code,
                amount=capture_amount,
            )

        capture_result = await gw.capture(
            preauth_id=payment.gateway_payment_id,
            amount=capture_amount,
            idempotency_key=str(_uuid.uuid4()),
        )

        stripe_charge_id = capture_result.gateway_charge_id

        captured_at = datetime.now(timezone.utc)
        await repo.update(
            payment.payment_id,
            status="CAPTURED",
            gateway_auth_code=stripe_charge_id,
            rental_agreement_id=str(data.rental_agreement_id),
            captured_at=captured_at,
        )

        # Post GL entries: Dr AR / Cr Revenue
        await self._post_gl_entry(
            GLJournalEntry(
                entry_type="REVENUE",
                debit_account="1100-ACCOUNTS-RECEIVABLE",
                credit_account="4000-RENTAL-REVENUE",
                amount=capture_amount,
                description=f"Capture for rental agreement {data.rental_agreement_id}",
                reference_id=payment.payment_id,
            )
        )

        await self._session.commit()

        log.info(
            "payment_captured",
            payment_id=payment.payment_id,
            amount=str(capture_amount),
            tenant_id=tenant_id,
        )

        return CaptureResponse(
            payment_id=UUID(payment.payment_id),
            captured_amount=capture_amount,
            stripe_charge_id=stripe_charge_id,
            captured_at=captured_at,
        )

    # ── Pre-Auth Renewal ──────────────────────────────────────────────────────

    async def renew_pre_auth(self, payment_id: str, tenant_id: str) -> None:
        """
        Called by the Celery task for pre-auths expiring within 24 hours.
        Uses Redis SETNX lock to prevent concurrent renewal of the same payment.
        """
        self._tenant_id = tenant_id
        repo = self._get_repo(tenant_id)
        payment = await repo.get_by_id(payment_id)
        if payment is None or payment.status != "AUTHORIZED":
            return

        redis = get_session_redis()
        reservation_id = payment.reservation_id or payment_id
        lock_key = PREAUTH_LOCK_KEY.format(reservation_id=reservation_id)

        # Acquire distributed lock (120-second TTL)
        acquired = await redis.set(lock_key, "1", ex=120, nx=True)
        if not acquired:
            log.info("preauth_renewal_skipped_locked", payment_id=payment_id)
            return

        try:
            import uuid as _uuid
            gw = await self._get_gateway()
            incr_result = await gw.incremental_auth(
                preauth_id=payment.gateway_payment_id,
                new_total_amount=payment.amount,
                idempotency_key=str(_uuid.uuid4()),
            )
            new_expiry = datetime.now(timezone.utc) + timedelta(days=_PRE_AUTH_EXPIRY_DAYS)
            await repo.update(
                payment_id,
                network_txn_id=incr_result.gateway_auth_code,
                auth_expiry_at=new_expiry,
            )
            await self._session.commit()
            log.info("preauth_renewed", payment_id=payment_id, new_expiry=new_expiry.isoformat())
        finally:
            await redis.delete(lock_key)

    # ── Void ─────────────────────────────────────────────────────────────────

    async def void_payment(self, data: VoidRequest, tenant_id: str) -> None:
        """Cancel an AUTHORIZED payment intent."""
        self._tenant_id = tenant_id
        repo = self._get_repo(tenant_id)
        payment = await repo.get_by_id(str(data.payment_id))
        if payment is None:
            raise ResourceNotFoundError("payments", str(data.payment_id))
        if payment.status not in ("AUTHORIZED", "PENDING"):
            raise ConflictError(
                f"Payment {data.payment_id} in status '{payment.status}' cannot be voided."
            )

        gw = await self._get_gateway()
        await gw.void(preauth_id=payment.gateway_payment_id)
        await repo.update(payment.payment_id, status="VOIDED")

        # Post GL reversal
        await self._post_gl_entry(
            GLJournalEntry(
                entry_type="REVERSAL",
                debit_account="2100-PREAUTH-MEMO",
                credit_account="1200-DEPOSIT-RECEIVABLE",
                amount=payment.amount,
                description=f"Void of pre-auth {payment.payment_id}",
                reference_id=payment.payment_id,
            )
        )

        await self._session.commit()

    # ── Refund ────────────────────────────────────────────────────────────────

    async def process_refund(
        self, data: RefundRequest, tenant_id: str
    ) -> Payment:
        """
        Route refunds:
          - AUTHORIZED → void instead
          - CAPTURED → gateway refund
          - amount > $500 → requires_approval=True (return Pending status)
        """
        self._tenant_id = tenant_id
        repo = self._get_repo(tenant_id)
        payment = await repo.get_by_id(str(data.payment_id))
        if payment is None:
            raise ResourceNotFoundError("payments", str(data.payment_id))

        # Validate refund does not exceed captured amount
        already_refunded = payment.refunded_amount or Decimal("0")
        if already_refunded + data.amount > payment.amount:
            raise ValidationError(
                f"Refund amount {data.amount} would exceed captured amount {payment.amount}."
            )

        # If still just authorized, void instead
        if payment.status == "AUTHORIZED":
            await self.void_payment(VoidRequest(payment_id=data.payment_id), tenant_id)
            return await repo.get_by_id(str(data.payment_id))  # type: ignore[return-value]

        if payment.status not in ("CAPTURED", "PARTIALLY_REFUNDED"):
            raise ConflictError(
                f"Payment {data.payment_id} in status '{payment.status}' cannot be refunded."
            )

        refund_cents = int(data.amount * 100)

        # ── Goodwill path: agent-issued, bypasses manager approval if within cap ──
        if data.is_goodwill and data.goodwill_under is not None:
            if data.amount > data.goodwill_under:
                raise ValidationError(
                    f"Goodwill refund {data.amount} exceeds agent authority {data.goodwill_under}."
                )
            if data.goodwill_customer_id:
                window_total = await self._get_goodwill_total(
                    tenant_id, str(data.goodwill_customer_id)
                )
                from app.core.config import settings
                cap = Decimal(str(settings.agent_goodwill_cap_usd))
                if window_total + data.amount > cap:
                    raise ValidationError(
                        f"Goodwill cap exceeded: {window_total} already issued this window."
                    )
            import uuid as _uuid
            gw = await self._get_gateway()
            await gw.refund(
                charge_id=payment.gateway_auth_code or "",
                amount=data.amount,
                reason=data.reason[:255] if data.reason else "",
                idempotency_key=str(_uuid.uuid4()),
            )
            new_refunded = (payment.refunded_amount or Decimal("0")) + data.amount
            new_status = "REFUNDED" if new_refunded >= payment.amount else "PARTIALLY_REFUNDED"
            await repo.update(payment.payment_id, refunded_amount=new_refunded, status=new_status)
            await self._session.commit()
            if data.goodwill_customer_id and data.goodwill_ra_id:
                await self._record_goodwill(
                    tenant_id=tenant_id,
                    customer_id=str(data.goodwill_customer_id),
                    ra_id=str(data.goodwill_ra_id),
                    amount=data.amount,
                    session_id=data.goodwill_session_id or "",
                    agent_name="ReturnAdvisor",
                )
            return await repo.get_by_id(payment.payment_id)  # type: ignore[return-value]

        # Large refunds require approval
        if refund_cents > _REFUND_APPROVAL_THRESHOLD_CENTS:
            await repo.update(
                payment.payment_id,
                requires_approval=True,
                notes=f"Pending approval: refund of {data.amount} requested by {data.initiated_by}",
            )
            await self._session.commit()
            refreshed = await repo.get_by_id(payment.payment_id)
            return refreshed  # type: ignore[return-value]

        import uuid as _uuid
        gw = await self._get_gateway()
        await gw.refund(
            charge_id=payment.gateway_auth_code or "",
            amount=data.amount,
            reason=data.reason[:255] if data.reason else "",
            idempotency_key=str(_uuid.uuid4()),
        )

        new_refunded = already_refunded + data.amount
        new_status = "REFUNDED" if new_refunded >= payment.amount else "PARTIALLY_REFUNDED"

        await repo.update(
            payment.payment_id,
            refunded_amount=new_refunded,
            status=new_status,
            refunded_at=datetime.now(timezone.utc),
        )
        await self._session.commit()

        return await repo.get_by_id(payment.payment_id)  # type: ignore[return-value]

    # ── Stripe Webhook ────────────────────────────────────────────────────────

    async def handle_stripe_webhook(
        self, event_id: str, event_type: str, payload: dict, tenant_id: str
    ) -> None:
        """
        Idempotent Stripe webhook handler.
        ProcessedWebhook INSERT and domain logic are in ONE transaction.
        """
        repo = self._get_repo(tenant_id)

        # Step 1: Idempotency guard + domain handler in same transaction
        async with self._session.begin():
            inserted = await repo.mark_webhook_processed(event_id)
            if not inserted:
                log.info("webhook_already_processed", event_id=event_id)
                return

            handler = {
                "payment_intent.succeeded": self._on_payment_intent_succeeded,
                "payment_intent.payment_failed": self._on_payment_intent_failed,
                "payment_intent.canceled": self._on_payment_intent_cancelled,
                "charge.refunded": self._on_charge_refunded,
                "charge.dispute.created": self._on_dispute_created,
            }.get(event_type)

            if handler:
                await handler(payload, repo)
            else:
                log.info("webhook_unhandled_event_type", event_type=event_type)

    async def _on_payment_intent_succeeded(
        self, payload: dict, repo: PaymentRepository
    ) -> None:
        intent_id = payload.get("id", "")
        payment = await repo.get_by_gateway_payment_id(intent_id)
        if payment and payment.status != "CAPTURED":
            await repo.update(payment.payment_id, status="CAPTURED")

    async def _on_payment_intent_failed(
        self, payload: dict, repo: PaymentRepository
    ) -> None:
        intent_id = payload.get("id", "")
        failure_message = (
            payload.get("last_payment_error", {}).get("message", "Payment failed")
        )
        payment = await repo.get_by_gateway_payment_id(intent_id)
        if payment:
            await repo.update(
                payment.payment_id,
                status="DECLINED",
                notes=failure_message,
            )

    async def _on_payment_intent_cancelled(
        self, payload: dict, repo: PaymentRepository
    ) -> None:
        intent_id = payload.get("id", "")
        payment = await repo.get_by_gateway_payment_id(intent_id)
        if payment:
            await repo.update(payment.payment_id, status="VOIDED")

    async def _on_charge_refunded(
        self, payload: dict, repo: PaymentRepository
    ) -> None:
        charge_id = payload.get("id", "")
        payment = await repo.get_by_gateway_payment_id(
            payload.get("payment_intent", "")
        )
        if payment:
            amount_refunded_cents = payload.get("amount_refunded", 0)
            refunded_amount = Decimal(amount_refunded_cents) / 100
            new_status = "REFUNDED" if refunded_amount >= payment.amount else "PARTIALLY_REFUNDED"
            await repo.update(
                payment.payment_id,
                refunded_amount=refunded_amount,
                status=new_status,
                refunded_at=datetime.now(timezone.utc),
            )

    async def _on_dispute_created(
        self, payload: dict, repo: PaymentRepository
    ) -> None:
        charge_id = payload.get("charge", "")
        intent_id = payload.get("payment_intent", "")
        payment = await repo.get_by_gateway_payment_id(intent_id or charge_id)
        if payment:
            dispute_info = {
                "dispute_id": payload.get("id"),
                "reason": payload.get("reason"),
                "amount": payload.get("amount"),
                "status": payload.get("status"),
            }
            import json
            existing_notes = payment.notes or ""
            await repo.update(
                payment.payment_id,
                status="DISPUTED",
                notes=f"{existing_notes}\nDISPUTE: {json.dumps(dispute_info)}".strip(),
            )
            log.warning(
                "stripe_dispute_created",
                payment_id=payment.payment_id,
                dispute_id=payload.get("id"),
                reason=payload.get("reason"),
            )

    # ── Read ──────────────────────────────────────────────────────────────────

    async def get_payment(self, payment_id: str, tenant_id: str) -> Payment:
        repo = self._get_repo(tenant_id)
        payment = await repo.get_by_id(payment_id)
        if payment is None:
            raise ResourceNotFoundError("payments", payment_id)
        return payment

    async def list_by_reservation(
        self, reservation_id: str, tenant_id: str
    ) -> list[Payment]:
        repo = self._get_repo(tenant_id)
        return await repo.list_by_reservation(reservation_id)

    # ── GL Helper ─────────────────────────────────────────────────────────────

    async def _post_gl_entry(self, entry: GLJournalEntry) -> None:
        """
        Post a General Ledger journal entry.
        Currently logs and returns; in production this would INSERT into a
        gl_journal_entries table or publish to an accounting integration.
        """
        log.info(
            "gl_journal_entry",
            entry_type=entry.entry_type,
            debit=entry.debit_account,
            credit=entry.credit_account,
            amount=str(entry.amount),
            reference_id=entry.reference_id,
        )

    # ── Goodwill Ledger Helpers ────────────────────────────────────────────────

    async def _get_goodwill_total(self, tenant_id: str, customer_id: str) -> Decimal:
        """Sum goodwill refunds issued to this customer in the rolling cap window."""
        from sqlalchemy import text as sqlt
        from app.core.config import settings
        result = await self._session.execute(
            sqlt("""
                SELECT COALESCE(SUM(amount), 0) FROM public.customer_goodwill_ledger
                WHERE tenant_id = :tid AND customer_id = :cid
                  AND issued_at >= NOW() - INTERVAL ':days days'
            """.replace(":days", str(settings.agent_goodwill_window_days))),
            {"tid": tenant_id, "cid": customer_id},
        )
        row = result.scalar_one()
        return Decimal(str(row or 0))

    async def _record_goodwill(
        self,
        tenant_id: str,
        customer_id: str,
        ra_id: str,
        amount: Decimal,
        session_id: str,
        agent_name: str,
    ) -> None:
        """Write a goodwill ledger entry (no FK — anonymization-safe)."""
        from sqlalchemy import text as sqlt
        await self._session.execute(
            sqlt("""
                INSERT INTO public.customer_goodwill_ledger
                    (tenant_id, customer_id, rental_agreement_id, amount, session_id, issued_by_agent)
                VALUES (:tid, :cid, :ra, :amt, :sid, :agent)
            """),
            {
                "tid": tenant_id,
                "cid": customer_id,
                "ra": ra_id,
                "amt": str(amount),
                "sid": session_id,
                "agent": agent_name,
            },
        )
        await self._session.commit()
