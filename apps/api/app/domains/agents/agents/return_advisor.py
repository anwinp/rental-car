from __future__ import annotations

import re
from decimal import Decimal

from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool

_RA_RE = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.IGNORECASE)
_CONF_RE = re.compile(r'\bRCM-\d{8}-[A-Z0-9]{6}\b', re.IGNORECASE)

_GOODWILL_CAP = Decimal("75.00")
_GOODWILL_AUTHORITY = Decimal("25.00")


class ReturnAdvisor(BaseAgent):
    """
    Explains return charges, answers questions about fees, and can issue
    small goodwill adjustments (≤ $25, capped $75/90 days) without escalation.
    """

    name = "ReturnAdvisor"

    async def handle(self, message: str, session: dict) -> dict:
        ctx = session.setdefault("context", {})
        lower = message.lower()
        step = ctx.get("return_step", "identify_ra")

        # ── Extract RA / confirmation number from message ──────────────────
        if not ctx.get("ra_id"):
            conf_match = _CONF_RE.search(message.upper())
            if conf_match:
                ra_result = await self._find_ra_by_confirmation(conf_match.group(0).upper())
                if ra_result:
                    ctx["ra_id"] = ra_result.get("ra_id")
                    ctx["confirmation_number"] = conf_match.group(0).upper()
                    ctx["customer_id"] = ra_result.get("customer_id")
                    ctx["payment_id"] = ra_result.get("payment_id")
                    ctx["return_step"] = "showing_breakdown"
                    session["context"] = ctx
                    return await self._show_receipt_breakdown(ctx)

        # ── Already have RA context ────────────────────────────────────────
        if ctx.get("ra_id"):
            if step == "showing_breakdown":
                if any(w in lower for w in ("explain", "why", "charge", "fee", "unfair", "dispute", "wrong")):
                    return await self._explain_charges(ctx, message)
                if any(w in lower for w in ("goodwill", "courtesy", "refund", "waive", "sorry", "compensation")):
                    return self._offer_goodwill(ctx)

            if step == "goodwill_offered":
                if any(w in lower for w in ("yes", "accept", "please", "ok")):
                    return await self._issue_goodwill(ctx, session)
                if any(w in lower for w in ("no", "more", "not enough")):
                    return {
                        "message": "I understand. For charges above my authority, I can escalate to a manager "
                                   "or connect you with our support team. Would you like me to do that?",
                        "card": None,
                        "chips": ["Yes, escalate", "No, that's fine"],
                    }

        # ── No context — ask for confirmation number ───────────────────────
        return {
            "message": "I can help you understand your return charges. "
                       "Could you share your confirmation number? It looks like RCM-YYYYMMDD-XXXXXX.",
            "card": None,
            "chips": ["I don't have it handy", "I have a question about fees"],
        }

    async def _find_ra_by_confirmation(self, conf_number: str) -> dict | None:
        from sqlalchemy import text as sqlt
        result = await self.tool.get(
            "/api/v1/reservations",
            confirmation_number=conf_number,
        )
        if result.success and isinstance(result.data, list) and result.data:
            res = result.data[0]
            reservation_id = res.get("reservation_id")
            if reservation_id:
                ra_result = await self.tool.get(
                    "/api/v1/checkout/agreements",
                    reservation_id=reservation_id,
                )
                if ra_result.success:
                    ras = ra_result.data if isinstance(ra_result.data, list) else [ra_result.data]
                    if ras:
                        return ras[0]
        return None

    async def _show_receipt_breakdown(self, ctx: dict) -> dict:
        ra_id = ctx.get("ra_id", "")
        result = await self.tool.get(f"/api/v1/checkout/agreements/{ra_id}/receipt-breakdown")

        if not result.success:
            return {
                "message": f"I found your return for **{ctx.get('confirmation_number', ra_id)}**. "
                           "How can I help you with your return charges?",
                "card": None,
                "chips": ["Explain my charges", "I think there's an error", "Request a courtesy adjustment"],
            }

        data = result.data
        ctx["breakdown"] = data
        items = data.get("line_items", [])
        total = data.get("subtotal", 0)

        return {
            "message": f"Here's the breakdown for your return{' — **' + ctx.get('confirmation_number', '') + '**' if ctx.get('confirmation_number') else ''}:",
            "card": {
                "kind": "receipt_breakdown",
                "data": {
                    "ra_id": ra_id,
                    "confirmation_number": ctx.get("confirmation_number"),
                    "miles_driven": data.get("miles_driven", 0),
                    "free_miles": data.get("free_miles_included", 0),
                    "overage_miles": data.get("overage_miles", 0),
                    "overage_charge": data.get("mileage_charge", 0),
                    "fuel_level_out": data.get("fuel_level_out_pct", 1.0),
                    "fuel_level_in": data.get("fuel_level_in_pct", 1.0),
                    "fuel_surcharge": data.get("fuel_surcharge", 0),
                    "late_minutes": data.get("late_return_minutes", 0),
                    "late_charge": data.get("late_return_charge", 0),
                    "subtotal": total,
                    "line_items": items,
                },
            },
            "chips": ["Explain these charges", "Request courtesy credit", "This looks wrong"],
        }

    async def _explain_charges(self, ctx: dict, message: str) -> dict:
        breakdown = ctx.get("breakdown", {})
        parts: list[str] = []

        overage = float(breakdown.get("overage_miles", 0))
        if overage > 0:
            rate = float(breakdown.get("overage_rate", 0.25))
            parts.append(f"**Mileage overage:** You drove {overage:.0f} miles over your included allowance. "
                         f"We charge ${rate:.2f}/mile for excess mileage, totaling ${breakdown.get('mileage_charge', 0):.2f}.")

        fuel_steps = int(breakdown.get("fuel_steps_below_contract", 0))
        if fuel_steps > 0:
            out_pct = float(breakdown.get("fuel_level_out_pct", 1.0))
            in_pct = float(breakdown.get("fuel_level_in_pct", 1.0))
            parts.append(f"**Fuel surcharge:** The vehicle went out at {out_pct*100:.0f}% and came back at "
                         f"{in_pct*100:.0f}%. We charge ${breakdown.get('fuel_charge_per_step', 15):.2f} per 1/8 tank "
                         f"below the contracted level ({fuel_steps} step{'s' if fuel_steps != 1 else ''}).")

        late_min = int(breakdown.get("late_return_minutes", 0))
        if late_min > 0:
            parts.append(f"**Late return:** The vehicle was returned {late_min} minutes late. "
                         f"We charge ${breakdown.get('late_fee_rate', 35):.2f}/hour for late returns.")

        if not parts:
            parts = ["Your return has no additional charges beyond your base rental rate."]

        msg = "\n\n".join(parts) + "\n\nIs there anything specific you'd like to dispute or discuss?"
        return {
            "message": msg,
            "card": None,
            "chips": ["Request a courtesy credit", "I'd like to dispute a charge", "That makes sense, thanks"],
        }

    def _offer_goodwill(self, ctx: dict) -> dict:
        ctx["return_step"] = "goodwill_offered"
        total = float((ctx.get("breakdown") or {}).get("subtotal", 0))
        offer = min(float(_GOODWILL_AUTHORITY), total * 0.5)
        offer = round(offer, 2)
        ctx["goodwill_offer"] = offer
        return {
            "message": f"As a courtesy for any inconvenience, I can apply a **${offer:.2f} credit** "
                       f"to your account. This is within my authority as your return advisor. "
                       f"Would you like me to apply this credit?",
            "card": None,
            "chips": [f"Yes, apply ${offer:.2f} credit", "No thank you", "I need more than that"],
        }

    async def _issue_goodwill(self, ctx: dict, session: dict) -> dict:
        offer = Decimal(str(ctx.get("goodwill_offer", 0)))
        payment_id = ctx.get("payment_id")
        customer_id = ctx.get("customer_id")
        ra_id = ctx.get("ra_id")

        if not payment_id:
            return {
                "message": "I wasn't able to process the credit automatically. "
                           "I've flagged this for a team member to follow up within 24 hours.",
                "card": None,
                "chips": ["Thank you", "I have more questions"],
            }

        result = await self.tool.post("/api/v1/payments/refund", {
            "payment_id": payment_id,
            "amount": str(offer),
            "reason": "Agent goodwill courtesy credit — ReturnAdvisor",
            "initiated_by": payment_id,
            "is_goodwill": True,
            "goodwill_under": str(_GOODWILL_AUTHORITY),
            "goodwill_session_id": session.get("session_id", ""),
            "goodwill_customer_id": customer_id,
            "goodwill_ra_id": ra_id,
        })

        if result.success:
            ctx["return_step"] = "resolved"
            session["context"] = ctx
            return {
                "message": f"Done! A **${offer:.2f} courtesy credit** has been applied. "
                           "You'll see it reflected on your statement within 3–5 business days. "
                           "Is there anything else I can help with?",
                "card": None,
                "chips": ["No, I'm all set", "Yes, one more thing"],
            }

        return {
            "message": "I ran into an issue applying the credit. I've noted this and a team member "
                       "will follow up within 24 hours to resolve it for you.",
            "card": None,
            "chips": ["Thank you", "I have more questions"],
        }
