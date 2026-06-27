from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any

from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool, ToolResult


class ReservationManager(BaseAgent):
    """
    Handles reservation modifications, cancellations, and date changes.
    Uses the tool wrapper to call the API over HTTP (preserves audit trail).
    """

    name = "ReservationManager"

    # Confirmation number pattern (RCM-YYYYMMDD-XXXXXX)
    _CONF_RE = re.compile(r'\bRCM-\d{8}-[A-Z0-9]{6}\b', re.IGNORECASE)

    async def handle(self, message: str, session: dict) -> dict:
        ctx = session.get("context", {})

        # --- 1. Extract confirmation number from message if not already in session ---
        conf_match = self._CONF_RE.search(message.upper())
        if conf_match and not ctx.get("reservation_id"):
            result = await self._load_by_confirmation(conf_match.group(0).upper())
            if result.success:
                ctx["reservation_id"] = result.data.get("reservation_id")
                ctx["confirmation_number"] = conf_match.group(0).upper()
                session["context"] = ctx
                return self._present_reservation(result.data, message)
            else:
                return {
                    "message": f"I couldn't find a reservation with confirmation number {conf_match.group(0).upper()}. "
                               "Please double-check the number and try again.",
                    "card": None,
                    "chips": ["Try a different number", "I need other help"],
                }

        # --- 2. Already have a reservation in context ---
        if ctx.get("reservation_id"):
            return await self._handle_with_context(message, session, ctx)

        # --- 3. No context yet — ask for confirmation number ---
        return {
            "message": "I can help you with your reservation. "
                       "Could you share your confirmation number? It looks like RCM-20260623-XXXXXX.",
            "card": None,
            "chips": ["I don't have my confirmation number", "Cancel a reservation", "Change my dates"],
        }

    async def _load_by_confirmation(self, confirmation_number: str) -> ToolResult:
        result = await self.tool.get(
            "/api/v1/reservations",
            confirmation_number=confirmation_number,
        )
        # Endpoint returns a list — unwrap the first item if found
        if result.success and isinstance(result.data, list):
            if result.data:
                result.data = result.data[0]
            else:
                return ToolResult(success=False, data={}, error_message="NOT_FOUND")
        elif result.success and isinstance(result.data, dict):
            # Some endpoints wrap in {"items": [...]} or return a direct dict
            items = result.data.get("items") or result.data.get("reservations")
            if items and isinstance(items, list) and items:
                result.data = items[0]
        return result

    async def _handle_with_context(self, message: str, session: dict, ctx: dict) -> dict:
        lower = message.lower()

        # Cancel intent
        if any(w in lower for w in ("cancel", "cancelling", "cancelled", "refund my", "don't need")):
            res_id = ctx["reservation_id"]
            preview = await self.tool.get(f"/api/v1/reservations/{res_id}/cancellation-preview")
            if preview.success:
                fee = preview.data.get("cancellation_fee", 0)
                refund = preview.data.get("refund_amount", 0)
                policy = preview.data.get("policy_name", "standard")
                return {
                    "message": f"Here's what cancellation would look like:",
                    "card": {
                        "kind": "cancellation_preview",
                        "data": {
                            "reservation_id": res_id,
                            "confirmation_number": ctx.get("confirmation_number"),
                            "cancellation_fee": fee,
                            "refund_amount": refund,
                            "policy_name": policy,
                        },
                    },
                    "chips": ["Yes, cancel my reservation", "No, keep it", "Talk to an agent"],
                }
            return {
                "message": "I wasn't able to load the cancellation details. Would you like me to connect you with a team member?",
                "card": None,
                "chips": ["Connect me to an agent", "Never mind"],
            }

        # Confirm cancellation
        if "yes, cancel" in lower or (("yes" in lower or "confirm" in lower) and "cancel" in lower):
            res_id = ctx["reservation_id"]
            result = await self.tool.post(
                f"/api/v1/reservations/{res_id}/cancel",
                {"reason": "Customer requested cancellation via AI agent", "initiated_by": "CUSTOMER"},
            )
            if result.success:
                conf = ctx.get("confirmation_number", res_id[:8])
                session["context"]["reservation_id"] = None
                session["context"]["resolved_issues"].append(f"cancelled:{conf}")
                return {
                    "message": f"Done — reservation {conf} has been cancelled. "
                               "You'll receive a confirmation email shortly with refund details.",
                    "card": None,
                    "chips": ["Make a new reservation", "I need other help"],
                }
            return {
                "message": "I ran into an issue processing the cancellation. "
                           "Please try again or contact our support team.",
                "card": None,
                "chips": ["Try again", "Talk to an agent"],
            }

        # Date change intent
        if any(w in lower for w in ("change", "modify", "move", "reschedule", "different date", "extend")):
            return {
                "message": "I can help update your dates. What new pickup and drop-off dates work for you? "
                           "You can say something like \"Change to June 28–July 2\".",
                "card": {
                    "kind": "date_modification",
                    "data": {
                        "reservation_id": ctx["reservation_id"],
                        "confirmation_number": ctx.get("confirmation_number"),
                    },
                },
                "chips": [],
            }

        # Fallback — show reservation details again
        res_id = ctx["reservation_id"]
        result = await self.tool.get(f"/api/v1/reservations/{res_id}")
        if result.success:
            return self._present_reservation(result.data, message)

        return {
            "message": "How can I help with your reservation? I can assist with date changes, cancellations, or answer questions.",
            "card": None,
            "chips": ["Change my dates", "Cancel reservation", "Other question"],
        }

    def _present_reservation(self, data: dict, _message: str) -> dict:
        res_id = data.get("reservation_id", "")
        conf = data.get("confirmation_number", "")
        status = data.get("status", "UNKNOWN")
        pickup = data.get("pickup_datetime") or data.get("pickup_dt", "")
        dropoff = data.get("return_datetime") or data.get("dropoff_dt", "")
        location = data.get("pickup_location_id", "")
        class_name = data.get("vehicle_class_name", data.get("vehicle_class_id", ""))

        if isinstance(pickup, str) and pickup:
            try:
                pickup = datetime.fromisoformat(pickup.replace("Z", "+00:00")).strftime("%b %d, %Y")
            except ValueError:
                pass
        if isinstance(dropoff, str) and dropoff:
            try:
                dropoff = datetime.fromisoformat(dropoff.replace("Z", "+00:00")).strftime("%b %d, %Y")
            except ValueError:
                pass

        return {
            "message": f"I found your reservation **{conf}**. What would you like to do?",
            "card": {
                "kind": "reservation_detail",
                "data": {
                    "reservation_id": res_id,
                    "confirmation_number": conf,
                    "status": status,
                    "pickup_date": str(pickup),
                    "dropoff_date": str(dropoff),
                    "pickup_location": str(location),
                    "vehicle_class": str(class_name),
                },
            },
            "chips": ["Change my dates", "Cancel this reservation", "Other question"],
        }
