from __future__ import annotations

import json
import logging

from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool

log = logging.getLogger(__name__)

DAMAGE_CLASSIFICATION_PROMPT = """You are a vehicle damage assessment specialist.
Compare the pre-rental and post-rental vehicle photos and classify any damage.

Respond ONLY with a valid JSON object in this exact format:
{
  "zone": "FRONT_BUMPER|REAR_BUMPER|DRIVER_DOOR|PASSENGER_DOOR|HOOD|ROOF|WINDSHIELD|WHEELS|INTERIOR|OTHER",
  "damage_type": "SCRATCH|DENT|CRACK|CHIP|MISSING_PART|FLOOD|BURN|NONE",
  "severity": "GRADE_1_COSMETIC|GRADE_2_MINOR|GRADE_3_MODERATE|GRADE_4_SEVERE|GRADE_5_TOTAL_LOSS|NONE",
  "confidence": 0.95,
  "reasoning": "Brief explanation of what you observed"
}

If pre and post photos appear identical with no new damage, set damage_type and severity to "NONE"."""


class ClaimsProcessor(BaseAgent):
    """
    AI-powered damage classification using vision model.
    Compares pre/post rental photos and classifies damage zone, type, and severity.
    Only runs when ANTHROPIC_API_KEY is configured.
    """

    name = "ClaimsProcessor"

    async def handle(self, message: str, session: dict) -> dict:
        ctx = session.setdefault("context", {})

        # ClaimsProcessor is invoked with a claim_id in context
        claim_id = ctx.get("damage_claim_id")
        if not claim_id:
            return {
                "message": "ClaimsProcessor requires an active damage claim in context.",
                "card": None,
                "chips": [],
            }

        # Load the claim to get photo URLs
        claim_result = await self.tool.get(f"/api/v1/damage/claims/{claim_id}")
        if not claim_result.success:
            return {
                "message": "Unable to load damage claim for assessment.",
                "card": None,
                "chips": [],
            }

        claim = claim_result.data
        pre_url = claim.get("pre_photo_url")
        post_url = claim.get("post_photo_url")

        if not pre_url or not post_url:
            return {
                "message": "Damage claim is missing pre or post rental photos. "
                           "Manual assessment required.",
                "card": None,
                "chips": ["Escalate to claims team"],
            }

        assessment = await self._classify_damage(pre_url, post_url, session=session)

        if not assessment:
            return {
                "message": "Automatic damage classification is temporarily unavailable. "
                           "A claims specialist will review within 24 hours.",
                "card": None,
                "chips": ["I understand", "Contact support"],
            }

        severity = assessment.get("severity", "NONE")
        confidence = float(assessment.get("confidence", 0))
        damage_type = assessment.get("damage_type", "NONE")

        # Auto-settle grade 1–2 with high confidence
        if severity in ("GRADE_1_COSMETIC", "GRADE_2_MINOR") and confidence >= 0.85 and damage_type != "NONE":
            settled = await self._auto_settle(claim_id, assessment)
            if settled:
                return {
                    "message": f"**Automated Assessment Complete**\n\n"
                               f"Zone: {assessment.get('zone', 'N/A')}\n"
                               f"Type: {damage_type}\n"
                               f"Severity: {severity}\n"
                               f"Confidence: {confidence:.0%}\n\n"
                               f"This claim has been automatically settled per our minor damage policy. "
                               f"You'll receive written confirmation within 24 hours.",
                    "card": {
                        "kind": "damage_comparison",
                        "data": {
                            "claim_id": claim_id,
                            "status": "PAID",
                            "zone": assessment.get("zone"),
                            "damage_type": damage_type,
                            "severity": severity,
                            "confidence": confidence,
                            "pre_photo_url": pre_url,
                            "post_photo_url": post_url,
                            "auto_settled": True,
                        },
                    },
                    "chips": ["View my claim", "I have questions"],
                }

        # High severity or low confidence — escalate
        return {
            "message": f"**Assessment Result**\n\n"
                       f"Zone: {assessment.get('zone', 'N/A')}\n"
                       f"Type: {damage_type}\n"
                       f"Severity: {severity}\n"
                       f"Confidence: {confidence:.0%}\n\n"
                       f"{assessment.get('reasoning', '')}\n\n"
                       f"Due to the severity or complexity of this damage, "
                       f"this claim requires manual review by a claims specialist.",
            "card": {
                "kind": "damage_comparison",
                "data": {
                    "claim_id": claim_id,
                    "status": claim.get("status", "OPEN"),
                    "zone": assessment.get("zone"),
                    "damage_type": damage_type,
                    "severity": severity,
                    "confidence": confidence,
                    "pre_photo_url": pre_url,
                    "post_photo_url": post_url,
                    "auto_settled": False,
                },
            },
            "chips": ["Dispute the assessment", "I understand", "Contact claims team"],
        }

    async def _classify_damage(self, pre_url: str, post_url: str, session: dict | None = None) -> dict | None:
        from app.core.config import settings
        # Prefer per-tenant key from session (BYOK), fall back to system key
        api_key = (session or {}).get("anthropic_api_key", "") or settings.anthropic_api_key.get_secret_value()
        if not api_key:
            return None

        try:
            import anthropic
            client = anthropic.AsyncAnthropic(api_key=api_key)
            response = await client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=512,
                messages=[{
                    "role": "user",
                    "content": [
                        {"type": "image", "source": {"type": "url", "url": pre_url}},
                        {"type": "image", "source": {"type": "url", "url": post_url}},
                        {"type": "text", "text": DAMAGE_CLASSIFICATION_PROMPT},
                    ],
                }],
            )
            raw = response.content[0].text.strip()
            # Extract JSON from the response
            start = raw.find("{")
            end = raw.rfind("}") + 1
            if start != -1 and end > start:
                return json.loads(raw[start:end])
        except Exception as exc:
            log.warning("damage_classification_failed error=%s", exc)
        return None

    async def _auto_settle(self, claim_id: str, assessment: dict) -> bool:
        result = await self.tool.post(
            f"/api/v1/damage/claims/{claim_id}/status",
            {
                "status": "PAID",
                "notes": f"Auto-settled by ClaimsProcessor: {assessment.get('severity')} "
                         f"{assessment.get('damage_type')} at {assessment.get('zone')} "
                         f"(confidence: {assessment.get('confidence', 0):.0%})",
            },
        )
        return result.success
