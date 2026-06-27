from __future__ import annotations

import re

from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool

_CLAIM_RE = re.compile(r'\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b', re.IGNORECASE)
_CONF_RE = re.compile(r'\bRCM-\d{8}-[A-Z0-9]{6}\b', re.IGNORECASE)


class DamageMediator(BaseAgent):
    """
    Handles damage claim inquiries: looks up claim status, explains charges,
    presents LOU calculations, and helps customers understand the dispute process.
    Does NOT auto-settle — escalates to ClaimsProcessor for AI assessment.
    """

    name = "DamageMediator"

    async def handle(self, message: str, session: dict) -> dict:
        ctx = session.setdefault("context", {})
        lower = message.lower()

        # ── Try to extract a claim or confirmation number ──────────────────
        if not ctx.get("damage_claim_id"):
            uuid_match = _CLAIM_RE.search(message)
            conf_match = _CONF_RE.search(message.upper())

            if uuid_match:
                return await self._load_claim(uuid_match.group(0), ctx, session)
            if conf_match:
                # Try to find the RA then the damage claim
                ra_result = await self._find_claim_by_confirmation(conf_match.group(0).upper())
                if ra_result:
                    return await self._load_claim(ra_result, ctx, session)

        # ── Already have claim context ─────────────────────────────────────
        if ctx.get("damage_claim_id"):
            if any(w in lower for w in ("lou", "loss of use", "downtime")):
                return await self._show_lou(ctx)
            if any(w in lower for w in ("dispute", "wrong", "unfair", "disagree")):
                return self._explain_dispute_process(ctx)
            if any(w in lower for w in ("status", "update", "progress")):
                return await self._show_claim_status(ctx)
            # Re-show claim details
            return await self._show_claim_status(ctx)

        return {
            "message": "I can help you with a damage claim. "
                       "Could you share your claim ID (UUID format) or rental confirmation number?",
            "card": None,
            "chips": ["I have my claim ID", "I have my confirmation number", "General question"],
        }

    async def _find_claim_by_confirmation(self, conf: str) -> str | None:
        result = await self.tool.get("/api/v1/reservations", confirmation_number=conf)
        if result.success and isinstance(result.data, list) and result.data:
            res_id = result.data[0].get("reservation_id")
            if res_id:
                claims = await self.tool.get("/api/v1/damage/claims", reservation_id=res_id)
                if claims.success:
                    data = claims.data
                    items = data if isinstance(data, list) else (data or {}).get("items", [])
                    if items:
                        return items[0].get("claim_id")
        return None

    async def _load_claim(self, claim_id: str, ctx: dict, session: dict) -> dict:
        result = await self.tool.get(f"/api/v1/damage/claims/{claim_id}")
        if not result.success:
            return {
                "message": f"I couldn't find a damage claim with that ID. "
                           "Please verify the claim ID and try again.",
                "card": None,
                "chips": ["Try a different ID", "I need other help"],
            }

        claim = result.data
        ctx["damage_claim_id"] = claim_id
        ctx["claim_status"] = claim.get("status")
        session["context"] = ctx

        return {
            "message": f"I found your damage claim. Here are the current details:",
            "card": {
                "kind": "damage_comparison",
                "data": {
                    "claim_id": claim_id,
                    "status": claim.get("status"),
                    "zone": claim.get("zone"),
                    "damage_type": claim.get("damage_type"),
                    "severity": claim.get("severity"),
                    "estimate_amount": float(claim.get("estimate_amount") or 0),
                    "deductible": float(claim.get("deductible_amount") or 0),
                    "pre_photo_url": claim.get("pre_photo_url"),
                    "post_photo_url": claim.get("post_photo_url"),
                    "created_at": str(claim.get("created_at", "")),
                },
            },
            "chips": ["Explain these charges", "View LOU calculation", "Dispute this claim"],
        }

    async def _show_claim_status(self, ctx: dict) -> dict:
        claim_id = ctx.get("damage_claim_id")
        result = await self.tool.get(f"/api/v1/damage/claims/{claim_id}")
        if result.success:
            claim = result.data
            return {
                "message": f"Current status: **{claim.get('status', 'UNKNOWN')}**. "
                           f"Your claim is being processed. Is there anything specific you'd like to know?",
                "card": {
                    "kind": "damage_comparison",
                    "data": {
                        "claim_id": claim_id,
                        "status": claim.get("status"),
                        "zone": claim.get("zone"),
                        "damage_type": claim.get("damage_type"),
                        "severity": claim.get("severity"),
                        "estimate_amount": float(claim.get("estimate_amount") or 0),
                        "deductible": float(claim.get("deductible_amount") or 0),
                        "pre_photo_url": claim.get("pre_photo_url"),
                        "post_photo_url": claim.get("post_photo_url"),
                        "created_at": str(claim.get("created_at", "")),
                    },
                },
                "chips": ["View LOU calculation", "Dispute this claim", "What happens next?"],
            }
        return {
            "message": "I wasn't able to load the latest claim status. Please try again shortly.",
            "card": None,
            "chips": ["Try again"],
        }

    async def _show_lou(self, ctx: dict) -> dict:
        claim_id = ctx.get("damage_claim_id")
        result = await self.tool.get(f"/api/v1/damage/claims/{claim_id}/lou")
        if result.success:
            data = result.data
            lou_days = int(data.get("lou_days", 0))
            daily = float(data.get("daily_rate", 0))
            factor = float(data.get("utilization_factor", 1.0))
            total = float(data.get("lou_amount", 0))
            return {
                "message": f"Here's the Loss of Use (LOU) calculation for your claim:\n\n"
                           f"**{lou_days} days** × ${daily:.2f}/day × {factor:.0%} utilization factor = **${total:.2f}**\n\n"
                           "LOU covers the revenue we lost while the vehicle was out of service.",
                "card": None,
                "chips": ["Dispute the LOU amount", "I understand, thank you", "What can I do?"],
            }
        return {
            "message": "LOU calculation is not yet complete for this claim.",
            "card": None,
            "chips": ["What happens next?", "Contact support"],
        }

    def _explain_dispute_process(self, ctx: dict) -> dict:
        return {
            "message": "To dispute a damage claim:\n\n"
                       "1. **Submit your dispute in writing** within 30 days of the claim notice\n"
                       "2. **Include supporting evidence** — photos, witness statements, or inspection reports\n"
                       "3. **Our claims team reviews** within 10 business days\n"
                       "4. **You'll receive a written response** with the outcome\n\n"
                       "Would you like me to help you prepare a dispute?",
            "card": None,
            "chips": ["Help me prepare a dispute", "Contact the claims team", "I'll review and come back"],
        }
