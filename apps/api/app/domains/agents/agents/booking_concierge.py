from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool


# Patterns for extracting dates in user messages
_DATE_PATTERNS = [
    re.compile(r'\b(\d{4}-\d{2}-\d{2})\b'),                                      # 2026-06-28
    re.compile(r'\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* (\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?\b', re.IGNORECASE),  # June 28 / June 28, 2026
    re.compile(r'\b(\d{1,2})[/\-](\d{1,2})(?:[/\-](\d{2,4}))?\b'),              # 6/28 or 6/28/26
]

_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}


def _extract_iso_dates(text: str) -> list[str]:
    """Extract date strings from natural language, return as YYYY-MM-DD list."""
    found: list[str] = []
    today = datetime.now(timezone.utc)
    year = today.year

    for m in _DATE_PATTERNS[0].finditer(text):
        found.append(m.group(1))

    for m in _DATE_PATTERNS[1].finditer(text):
        month = _MONTHS.get(m.group(1).lower()[:3], 0)
        day = int(m.group(2))
        yr = int(m.group(3)) if m.group(3) else year
        if yr < 100:
            yr += 2000
        if month:
            found.append(f"{yr:04d}-{month:02d}-{day:02d}")

    for m in _DATE_PATTERNS[2].finditer(text):
        mo, dy = int(m.group(1)), int(m.group(2))
        yr_raw = m.group(3)
        yr = (int(yr_raw) + 2000 if yr_raw and int(yr_raw) < 100 else int(yr_raw)) if yr_raw else year
        if 1 <= mo <= 12 and 1 <= dy <= 31:
            found.append(f"{yr:04d}-{mo:02d}-{dy:02d}")

    # Deduplicate, preserve order
    seen: set[str] = set()
    result: list[str] = []
    for d in found:
        if d not in seen:
            seen.add(d)
            result.append(d)
    return result


def _extract_location(text: str) -> str | None:
    """Extract a location hint from the message. Returns the best guess or None."""
    patterns = [
        re.compile(r'(?:from|at|in|pickup(?:\s+at)?|pick up at?)\s+([A-Za-z][A-Za-z\s\-]{2,40}?)(?:\s+(?:on|from|to|and|for|between)|\.|,|$)', re.IGNORECASE),
        re.compile(r'(?:airport|location|branch)\s+(?:in\s+)?([A-Za-z][A-Za-z\s\-]{2,30})', re.IGNORECASE),
    ]
    for p in patterns:
        m = p.search(text)
        if m:
            return m.group(1).strip()
    return None


class BookingConcierge(BaseAgent):
    """
    Guides users through the new-reservation funnel:
    location → dates → vehicle class → quote → guest details → confirmation.
    """

    name = "BookingConcierge"

    async def handle(self, message: str, session: dict) -> dict:
        ctx = session.setdefault("context", {})
        step = ctx.get("booking_step", "collecting_info")

        lower = message.lower()

        # ── Handle "select [class]" action from chips ──────────────────────
        select_match = re.match(r'^select\s+(.+)$', lower.strip())
        if select_match and step == "showing_availability":
            class_name = select_match.group(1).strip()
            return await self._handle_class_selection(class_name, session, ctx)

        # ── Handle quote confirmation ──────────────────────────────────────
        if step == "showing_quote":
            if any(w in lower for w in ("yes", "confirm", "proceed", "book", "reserve", "looks good")):
                return self._ask_guest_details(ctx)
            if any(w in lower for w in ("no", "cancel", "different", "change", "back")):
                ctx["booking_step"] = "collecting_info"
                ctx.pop("quote_token", None)
                return {
                    "message": "No problem. Let's start over — where and when would you like to pick up a car?",
                    "card": None,
                    "chips": ["Search again", "I need help"],
                }

        # ── Handle guest details submission ────────────────────────────────
        if step == "collecting_guest_info":
            # Frontend sends as "Book: first_name=X last_name=Y email=Z phone=P"
            if message.startswith("Book:"):
                return await self._create_reservation(message, session, ctx)

        # ── Extract dates from message ─────────────────────────────────────
        dates = _extract_iso_dates(message)
        if dates:
            if len(dates) >= 2:
                ctx["pickup_date"] = dates[0]
                ctx["dropoff_date"] = dates[1]
            elif len(dates) == 1:
                if not ctx.get("pickup_date"):
                    ctx["pickup_date"] = dates[0]
                elif not ctx.get("dropoff_date"):
                    ctx["dropoff_date"] = dates[0]

        # ── Extract location ───────────────────────────────────────────────
        loc = _extract_location(message)
        if loc and not ctx.get("pickup_location"):
            ctx["pickup_location"] = loc

        # Check if we can proceed to search
        if ctx.get("pickup_location") and ctx.get("pickup_date") and ctx.get("dropoff_date"):
            return await self._search_availability(session, ctx)

        # ── Ask for missing info ───────────────────────────────────────────
        return self._ask_for_missing_info(ctx)

    def _ask_for_missing_info(self, ctx: dict) -> dict:
        missing = []
        if not ctx.get("pickup_location"):
            missing.append("pickup location")
        if not ctx.get("pickup_date"):
            missing.append("pickup date")
        if not ctx.get("dropoff_date"):
            missing.append("return date")

        if "pickup location" in missing:
            return {
                "message": "I'd be happy to help you find a rental! Which city or airport would you like to pick up from?",
                "card": None,
                "chips": ["Boston Logan Airport", "New York - JFK", "Los Angeles - LAX"],
            }
        if "pickup date" in missing:
            return {
                "message": f"Great — picking up in **{ctx['pickup_location']}**. What date works for pickup?",
                "card": None,
                "chips": ["Tomorrow", "This weekend", "Next week"],
            }
        return {
            "message": "And when will you return the car?",
            "card": None,
            "chips": ["Same day", "3 days later", "1 week"],
        }

    async def _search_availability(self, session: dict, ctx: dict) -> dict:
        result = await self.tool.get(
            "/api/v1/fleet/search",
            pickup_location_id=ctx["pickup_location"],
            dropoff_location_id=ctx.get("dropoff_location", ctx["pickup_location"]),
            pickup_date=ctx["pickup_date"],
            dropoff_date=ctx["dropoff_date"],
        )

        if not result.success:
            ctx["booking_step"] = "collecting_info"
            return {
                "message": f"I wasn't able to find availability for **{ctx['pickup_location']}**. "
                           "Could you double-check the location name?",
                "card": None,
                "chips": ["Try a different location", "I need help"],
            }

        classes: list[dict] = (result.data or {}).get("classes", [])
        available = [c for c in classes if c.get("availableCount", 0) > 0]

        if not available:
            return {
                "message": f"No vehicles are available in **{ctx['pickup_location']}** for those dates. "
                           "Try different dates or a nearby location.",
                "card": None,
                "chips": ["Try different dates", "Try another location"],
            }

        ctx["booking_step"] = "showing_availability"
        ctx["search_results"] = available
        # Store resolved UUID so the pricing quote can use it directly
        resolved_loc = (result.data or {}).get("resolved_location_id")
        if resolved_loc:
            ctx["pickup_location_id"] = resolved_loc
        session["context"] = ctx

        pickup_fmt = _fmt_date(ctx["pickup_date"])
        dropoff_fmt = _fmt_date(ctx["dropoff_date"])

        return {
            "message": f"Here's what's available in **{ctx['pickup_location']}** from {pickup_fmt} to {dropoff_fmt}:",
            "card": {
                "kind": "vehicle_class_list",
                "data": {
                    "classes": [
                        {
                            "class_id": c["classId"],
                            "class_code": c.get("classCode", ""),
                            "class_name": c["className"],
                            "description": c.get("description", ""),
                            "features": c.get("features", []),
                            "available_count": c["availableCount"],
                            "daily_rate": c.get("baseDailyRate", 0.0),
                            "currency_code": c.get("currencyCode", "USD"),
                        }
                        for c in available
                    ],
                    "pickup_date": ctx["pickup_date"],
                    "dropoff_date": ctx["dropoff_date"],
                    "pickup_location": ctx["pickup_location"],
                },
            },
            "chips": [f"Select {c.get('className', c.get('class_name', ''))}" for c in available[:3]],
        }

    async def _handle_class_selection(self, class_name: str, session: dict, ctx: dict) -> dict:
        search_results: list[dict] = ctx.get("search_results", [])

        def _name(c: dict) -> str:
            # search_results store raw API camelCase keys
            return c.get("class_name") or c.get("className") or ""

        def _id(c: dict) -> str:
            return c.get("class_id") or c.get("classId") or ""

        def _rate(c: dict) -> float:
            return float(c.get("daily_rate") or c.get("baseDailyRate") or 0.0)

        # Find the class by name (case-insensitive partial match)
        selected: dict | None = None
        for c in search_results:
            cname = _name(c).lower()
            if class_name in cname or cname in class_name:
                selected = c
                break

        if not selected and search_results:
            selected = search_results[0]

        if not selected:
            return {
                "message": "I couldn't find that vehicle class. Which one would you like?",
                "card": None,
                "chips": [f"Select {_name(c)}" for c in search_results[:3]],
            }

        # Build pricing quote
        ctx["selected_class_id"] = _id(selected)
        ctx["selected_class_name"] = _name(selected)

        result = await self.tool.post("/api/v1/pricing/quote", {
            "location_id": ctx.get("pickup_location_id") or _resolve_location_id_stub(ctx),
            "vehicle_class_id": _id(selected),
            "pickup_dt": f"{ctx['pickup_date']}T10:00:00+00:00",
            "dropoff_dt": f"{ctx['dropoff_date']}T10:00:00+00:00",
            "extras": [],
            "currency": "USD",
        })

        if not result.success:
            # Fallback — estimate from daily rate
            days = _days_between(ctx["pickup_date"], ctx["dropoff_date"])
            daily = _rate(selected)
            est_total = round(daily * days, 2)

            ctx["booking_step"] = "showing_quote"
            ctx["quote_token"] = None
            ctx["quote_total"] = est_total
            session["context"] = ctx

            return {
                "message": f"Here's your estimated quote for {_name(selected)}:",
                "card": {
                    "kind": "quote_summary",
                    "data": {
                        "vehicle_class_name": _name(selected),
                        "pickup_date": ctx["pickup_date"],
                        "dropoff_date": ctx["dropoff_date"],
                        "rental_days": days,
                        "daily_rate": daily,
                        "subtotal": est_total,
                        "taxes": 0.0,
                        "total": est_total,
                        "currency": "USD",
                        "quote_token": None,
                        "line_items": [
                            {"description": f"Base rate ({days} day{'s' if days != 1 else ''})", "amount": est_total}
                        ],
                        "is_estimate": True,
                    },
                },
                "chips": ["Yes, proceed to book", "Choose a different car", "Add extras"],
            }

        data = result.data
        ctx["booking_step"] = "showing_quote"
        ctx["quote_token"] = data.get("quote_token")
        ctx["quote_total"] = float(data.get("total", 0))
        ctx["quote_expires"] = data.get("expires_at")
        session["context"] = ctx

        days = float(data.get("rental_days", 1))
        total = float(data.get("total", 0))
        subtotal = float(data.get("subtotal", total))
        taxes = float(data.get("taxes", 0))
        line_items = [
            {"description": li.get("description", ""), "amount": float(li.get("amount", 0))}
            for li in (data.get("line_items") or [])
        ]
        if not line_items:
            line_items = [{"description": f"Base rental ({int(days)} days)", "amount": subtotal}]

        return {
            "message": f"Here's your quote for the **{_name(selected)}**:",
            "card": {
                "kind": "quote_summary",
                "data": {
                    "vehicle_class_name": _name(selected),
                    "pickup_date": ctx["pickup_date"],
                    "dropoff_date": ctx["dropoff_date"],
                    "rental_days": days,
                    "daily_rate": _rate(selected),
                    "subtotal": subtotal,
                    "taxes": taxes,
                    "total": total,
                    "currency": data.get("currency", "USD"),
                    "quote_token": ctx["quote_token"],
                    "line_items": line_items,
                    "is_estimate": False,
                },
            },
            "chips": ["Yes, proceed to book", "Choose a different car", "Add extras"],
        }

    def _ask_guest_details(self, ctx: dict) -> dict:
        ctx["booking_step"] = "collecting_guest_info"
        return {
            "message": "Almost there! Please fill in your details to complete the booking.",
            "card": {
                "kind": "guest_details_form",
                "data": {
                    "quote_token": ctx.get("quote_token"),
                    "vehicle_class_id": ctx.get("selected_class_id"),
                    "vehicle_class_name": ctx.get("selected_class_name"),
                    "pickup_date": ctx.get("pickup_date"),
                    "dropoff_date": ctx.get("dropoff_date"),
                    "total": ctx.get("quote_total", 0.0),
                },
            },
            "chips": [],
        }

    async def _create_reservation(self, message: str, session: dict, ctx: dict) -> dict:
        # Parse "Book: first_name=X last_name=Y email=Z phone=P"
        params: dict[str, str] = {}
        for part in message.replace("Book:", "").strip().split("||"):
            kv = part.strip().split("=", 1)
            if len(kv) == 2:
                params[kv[0].strip()] = kv[1].strip()

        first_name = params.get("first_name", "")
        last_name = params.get("last_name", "")
        email = params.get("email", "")
        phone = params.get("phone")

        if not first_name or not last_name or not email:
            return {
                "message": "I need your first name, last name, and email to complete the booking.",
                "card": {
                    "kind": "guest_details_form",
                    "data": {
                        "quote_token": ctx.get("quote_token"),
                        "vehicle_class_id": ctx.get("selected_class_id"),
                        "vehicle_class_name": ctx.get("selected_class_name"),
                        "pickup_date": ctx.get("pickup_date"),
                        "dropoff_date": ctx.get("dropoff_date"),
                        "total": ctx.get("quote_total", 0.0),
                        "error": "Please fill in all required fields.",
                    },
                },
                "chips": [],
            }

        payload: dict[str, Any] = {
            "guest_info": {
                "first_name": first_name,
                "last_name": last_name,
                "email": email,
                **({"phone": phone} if phone else {}),
            },
            "vehicle_class_id": ctx.get("selected_class_id"),
            "pickup_location": ctx.get("pickup_location"),
            "pickup_date": ctx.get("pickup_date"),
            "dropoff_date": ctx.get("dropoff_date"),
            "extras": [],
        }

        result = await self.tool.post("/api/v1/reservations/guest", payload)

        if result.success:
            conf = result.data.get("confirmation_number", "")
            ctx["booking_step"] = "confirmed"
            ctx["confirmation_number"] = conf
            session["context"] = ctx
            return {
                "message": f"Your reservation is confirmed! Confirmation number: **{conf}**\n\n"
                           f"A confirmation email has been sent to {email}. "
                           "Is there anything else I can help with?",
                "card": None,
                "chips": ["View my reservation", "Make another booking", "No, that's all"],
            }

        error_detail = ""
        if isinstance(result.data, dict):
            error_detail = result.data.get("detail", "")
        return {
            "message": f"I ran into an issue completing your booking. {error_detail or 'Please try again or contact support.'}",
            "card": None,
            "chips": ["Try again", "Talk to an agent"],
        }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_date(d: str) -> str:
    try:
        return datetime.fromisoformat(d).strftime("%b %d, %Y")
    except ValueError:
        return d


def _days_between(start: str, end: str) -> int:
    try:
        a = datetime.fromisoformat(start)
        b = datetime.fromisoformat(end)
        return max(1, (b - a).days)
    except ValueError:
        return 1


def _resolve_location_id_stub(ctx: dict) -> str:
    """Return the pickup_location value — the pricing API accepts UUID or short_code."""
    return ctx.get("pickup_location", "")
