from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone

from openai import AsyncOpenAI

from app.core.config import settings
from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool

log = logging.getLogger(__name__)

# Hard cap on tool-call iterations per turn — prevents runaway loops.
_MAX_TOOL_ROUNDS = 6

_SYSTEM_PROMPT = """You are the RCM Assistant, a friendly and concise virtual concierge for a premium car-rental company.

Your job is to help customers:
- Find and book a rental car (search availability, get a price quote, then create the reservation).
- Look up an existing reservation by its confirmation number (format RCM-YYYYMMDD-XXXXXX).
- Change dates or cancel an existing reservation.
- Answer general questions about the rental process.

Guidelines:
- Be warm, natural, and brief. Never sound like a scripted bot. Vary your wording.
- Use the available tools to fetch real data — never invent prices, availability, or reservation details.
- Location names must be exact. If the customer gives a vague location (e.g. "Boston airport"), call list_locations and pick the matching official name or short code before calling search_fleet.
- To book a car you must, in order: (1) resolve the location via list_locations if unsure, (2) search_fleet for the location and dates, (3) get_quote for the chosen vehicle class, (4) once the customer confirms, create_reservation with their name and email.
- Collect the customer's first name, last name, and email before creating a reservation. Ask for anything missing.
- Before cancelling, call preview_cancellation and tell the customer the fee and refund, then confirm with them before calling cancel_reservation.
- When a tool returns an error, apologise briefly and offer an alternative — do not expose raw error text or internal IDs.
- Today's date is {today}. Interpret relative dates ("next weekend", "tomorrow") accordingly. Dates passed to tools must be YYYY-MM-DD.
- Keep replies to a few sentences. Use plain language, not jargon.
"""

# ── Tool schemas exposed to the model ─────────────────────────────────────────

_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_locations",
            "description": "List the company's rental locations (exact names and codes). Call this to resolve a customer's location before searching availability.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_fleet",
            "description": "Search available rental vehicles for a pickup location and date range. The location must be an exact location name or short code from list_locations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "Exact location name or short code from list_locations, e.g. 'Boston Logan International Airport' or 'BOS01'."},
                    "pickup_date": {"type": "string", "description": "Pickup date, YYYY-MM-DD."},
                    "dropoff_date": {"type": "string", "description": "Return date, YYYY-MM-DD."},
                },
                "required": ["location", "pickup_date", "dropoff_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_quote",
            "description": "Get an exact price quote for a specific vehicle class. Call search_fleet first to get a vehicle_class_id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "vehicle_class_id": {"type": "string", "description": "The class_id returned by search_fleet."},
                },
                "required": ["vehicle_class_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_reservation",
            "description": "Look up an existing reservation by its confirmation number (RCM-YYYYMMDD-XXXXXX).",
            "parameters": {
                "type": "object",
                "properties": {
                    "confirmation_number": {"type": "string", "description": "e.g. RCM-20260701-AB12CD"},
                },
                "required": ["confirmation_number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "preview_cancellation",
            "description": "Preview the cancellation fee and refund for the reservation currently in context. Call lookup_reservation first.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "cancel_reservation",
            "description": "Cancel the reservation currently in context. Only call after preview_cancellation and explicit customer confirmation.",
            "parameters": {
                "type": "object",
                "properties": {
                    "reason": {"type": "string", "description": "Short reason for the cancellation."},
                },
                "required": ["reason"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_reservation",
            "description": "Create a new reservation after the customer has chosen a vehicle class, seen a quote, and confirmed. Requires their name and email.",
            "parameters": {
                "type": "object",
                "properties": {
                    "first_name": {"type": "string"},
                    "last_name": {"type": "string"},
                    "email": {"type": "string"},
                    "phone": {"type": "string"},
                    "vehicle_class_id": {"type": "string", "description": "class_id from search_fleet."},
                },
                "required": ["first_name", "last_name", "email", "vehicle_class_id"],
            },
        },
    },
]


class LLMAgent(BaseAgent):
    """
    LLM-driven conversational agent. Uses an OpenAI-compatible chat model
    (NVIDIA NIM by default) with tool-calling to access the real rental API
    through AgentTool. Replaces the rule-based scripted agents.
    """

    name = "RCMAssistant"

    def __init__(self, tool: AgentTool):
        super().__init__(tool)
        self._client = AsyncOpenAI(
            api_key=settings.llm_api_key.get_secret_value(),
            base_url=settings.llm_base_url,
        )

    async def handle(self, message: str, session: dict) -> dict:
        ctx = session.setdefault("context", {})
        today = datetime.now(timezone.utc).strftime("%A, %B %d, %Y")

        # ── Deterministic, card-driven booking flow ───────────────────────────
        # The booking happy-path is handled in code (not via the LLM) so it is
        # 100% reliable regardless of model quality: it always shows the right
        # interactive card next. Free-form questions still fall through to the LLM.
        booking = await self._booking_fast_path(message, ctx)
        if booking is not None:
            return booking

        # Build OpenAI message list from persisted conversation (already includes
        # the current user turn — the orchestrator appended it before calling us).
        messages: list[dict] = [
            {"role": "system", "content": _SYSTEM_PROMPT.format(today=today)}
        ]
        for m in session.get("messages", []):
            role = m.get("role")
            if role in ("user", "assistant") and m.get("content"):
                messages.append({"role": role, "content": m["content"]})

        pending_card: dict | None = None

        for _round in range(_MAX_TOOL_ROUNDS):
            try:
                resp = await self._client.chat.completions.create(
                    model=settings.llm_model,
                    messages=messages,
                    tools=_TOOLS,
                    tool_choice="auto",
                    temperature=0.4,
                    max_tokens=1024,
                )
            except Exception as exc:
                log.warning("llm_call_failed error=%s", exc)
                return {
                    "message": "I'm having a little trouble thinking right now — could you try that again in a moment?",
                    "card": None,
                    "chips": [],
                }

            choice = resp.choices[0]
            msg = choice.message
            tool_calls = msg.tool_calls or []

            if not tool_calls:
                # Final natural-language answer.
                return {
                    "message": (msg.content or "").strip()
                    or "Sorry, I didn't catch that — could you rephrase?",
                    "card": pending_card,
                    "chips": [],
                }

            # Append the assistant's tool-call message, then execute each tool.
            messages.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [
                    {
                        "id": tc.id,
                        "type": "function",
                        "function": {"name": tc.function.name, "arguments": tc.function.arguments},
                    }
                    for tc in tool_calls
                ],
            })

            for tc in tool_calls:
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                result_text, card = await self._run_tool(tc.function.name, args, session, ctx)
                if card is not None:
                    pending_card = card
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result_text,
                })

        # Exhausted tool rounds without a final text answer.
        return {
            "message": "I've pulled together what I can — what would you like to do next?",
            "card": pending_card,
            "chips": [],
        }

    # ── Deterministic booking flow ────────────────────────────────────────────

    _BOOKING_INTENT = re.compile(
        r'\b(book|rent|reserve|hire)\b.*\b(car|vehicle|suv|ride)\b'
        r'|\b(book a car|rent a car|reserve a car|make a booking|new booking|need a car|hire a car)\b',
        re.I,
    )
    _HAS_DATE = re.compile(r'\d{4}-\d{2}-\d{2}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)', re.I)

    async def _booking_fast_path(self, message: str, ctx: dict) -> dict | None:
        """Handle the structured booking steps deterministically. Returns a
        response dict to short-circuit the LLM, or None to fall through."""
        text = message.strip()

        # 1. Guest-details form submission → create the reservation.
        if text.startswith("Book:"):
            return await self._do_create(text[len("Book:"):], ctx)

        # 2. Search-form submission → search fleet, show vehicle cards.
        if text.startswith("__rcm_book__"):
            return await self._do_search(text[len("__rcm_book__"):], ctx)

        # 3. Vehicle selection → price quote.
        m = re.match(r'^select\s+(.+)$', text, re.I)
        if m and ctx.get("last_search"):
            return await self._do_quote(m.group(1).strip(), ctx)

        # 4. "Change options" / "different car" → re-show the vehicle list.
        if re.search(r'choose a different car|change options|different car|back to (cars|options)', text, re.I) \
                and (ctx.get("last_search") or {}).get("classes"):
            return self._reshow_vehicles(ctx)

        # 5. Confirm quote → show guest-details form.
        if ctx.get("quote_token") is not None \
                and re.search(r'proceed to book|confirm booking|yes,? proceed|book it|looks good', text, re.I):
            return self._guest_form(ctx)

        # 6. Fresh booking intent (no dates given) → show the search form.
        if self._BOOKING_INTENT.search(text) and not self._HAS_DATE.search(text):
            return await self._show_booking_form()

        return None

    async def _show_booking_form(self) -> dict:
        result = await self.tool.get("/api/v1/locations/public")
        locations = []
        if result.success and isinstance(result.data, list):
            locations = [
                {"name": l.get("name"), "short_code": l.get("short_code"), "city": l.get("city")}
                for l in result.data
            ]
        return {
            "message": "I'd be happy to help you book a car. Pick your location and dates to see what's available:",
            "card": {"kind": "booking_search_form", "data": {"locations": locations}},
            "chips": [],
        }

    async def _do_search(self, raw: str, ctx: dict) -> dict:
        p = self._parse_kv(raw)
        pickup_loc = p.get("pickup_location") or p.get("location", "")
        dropoff_loc = p.get("dropoff_location") or pickup_loc
        summary, card = await self._t_search_fleet(
            {"location": pickup_loc, "dropoff_location": dropoff_loc,
             "pickup_date": p.get("pickup", ""), "dropoff_date": p.get("dropoff", "")},
            ctx,
        )
        if card:
            return {"message": "Here's what's available for your dates. Select a class to see the full price:", "card": card, "chips": []}
        return {
            "message": "I couldn't find any vehicles available for those dates. Try different dates or another location.",
            "card": None,
            "chips": ["Start a new search"],
        }

    async def _do_quote(self, class_name: str, ctx: dict) -> dict:
        search = ctx.get("last_search") or {}
        classes = search.get("classes", [])
        sel = next(
            (c for c in classes if (c.get("className") or "").lower() == class_name.lower()
             or class_name.lower() in (c.get("className") or "").lower()),
            None,
        )
        if not sel and classes:
            sel = classes[0]
        if not sel:
            return {"message": "Which class would you like? Please pick one from the list above.", "card": None, "chips": []}
        summary, card = await self._t_get_quote({"vehicle_class_id": sel.get("classId")}, ctx)
        if card:
            return {"message": f"Here's your quote for the {sel.get('className')}. Review and confirm when you're ready:", "card": card, "chips": []}
        return {"message": "I couldn't price that vehicle just now — please try another class.", "card": None, "chips": []}

    def _reshow_vehicles(self, ctx: dict) -> dict:
        search = ctx.get("last_search") or {}
        card = self._build_vehicle_card(
            search.get("classes", []), search.get("pickup_date", ""),
            search.get("dropoff_date", ""), search.get("location", ""),
        )
        return {"message": "No problem — here are the available classes again:", "card": card, "chips": []}

    def _guest_form(self, ctx: dict) -> dict:
        return {
            "message": "Almost there! Enter your details to complete the booking:",
            "card": {
                "kind": "guest_details_form",
                "data": {
                    "vehicle_class_name": ctx.get("selected_class_name"),
                    "total": ctx.get("quote_total", 0.0),
                },
            },
            "chips": [],
        }

    async def _do_create(self, raw: str, ctx: dict) -> dict:
        p = self._parse_kv(raw)
        args = {
            "first_name": p.get("first_name", ""),
            "last_name": p.get("last_name", ""),
            "email": p.get("email", ""),
            "vehicle_class_id": ctx.get("selected_class_id"),
        }
        if p.get("phone"):
            args["phone"] = p["phone"]
        summary, _ = await self._t_create_reservation(args, ctx)
        data = json.loads(summary)
        if data.get("booked"):
            search = ctx.get("last_search") or {}
            card = {
                "kind": "booking_confirmed",
                "data": {
                    "confirmation_number": data.get("confirmation_number"),
                    "vehicle_class_name": ctx.get("selected_class_name"),
                    "location": search.get("location"),
                    "dropoff_location": search.get("dropoff_location"),
                    "pickup_date": search.get("pickup_date"),
                    "dropoff_date": search.get("dropoff_date"),
                    "total": ctx.get("quote_total", 0.0),
                    "email": p.get("email", ""),
                },
            }
            return {"message": "You're all set — your booking is confirmed! 🎉", "card": card, "chips": ["Book another car"]}
        return {
            "message": f"I couldn't complete the booking: {data.get('error', 'please try again')}.",
            "card": None,
            "chips": ["Try again"],
        }

    @staticmethod
    def _parse_kv(raw: str) -> dict:
        out: dict[str, str] = {}
        for part in raw.split("||"):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
        return out

    # ── Tool dispatch ─────────────────────────────────────────────────────────

    async def _run_tool(self, name: str, args: dict, session: dict, ctx: dict) -> tuple[str, dict | None]:
        """Execute a tool, returning (summary_for_model, optional_card)."""
        try:
            if name == "list_locations":
                return await self._t_list_locations()
            if name == "search_fleet":
                return await self._t_search_fleet(args, ctx)
            if name == "get_quote":
                return await self._t_get_quote(args, ctx)
            if name == "lookup_reservation":
                return await self._t_lookup_reservation(args, ctx)
            if name == "preview_cancellation":
                return await self._t_preview_cancellation(ctx)
            if name == "cancel_reservation":
                return await self._t_cancel_reservation(args, ctx)
            if name == "create_reservation":
                return await self._t_create_reservation(args, ctx)
        except Exception as exc:
            log.warning("tool_failed name=%s error=%s", name, exc)
            return json.dumps({"error": "tool execution failed"}), None
        return json.dumps({"error": f"unknown tool {name}"}), None

    async def _t_list_locations(self) -> tuple[str, dict | None]:
        result = await self.tool.get("/api/v1/locations/public")
        if not result.success or not isinstance(result.data, list):
            return json.dumps({"error": "could not load locations"}), None
        locs = [
            {"name": l.get("name"), "short_code": l.get("short_code"), "city": l.get("city")}
            for l in result.data
        ]
        return json.dumps({"locations": locs}), None

    async def _t_search_fleet(self, args: dict, ctx: dict) -> tuple[str, dict | None]:
        location = args.get("location", "")
        dropoff_location = args.get("dropoff_location") or location
        pickup = args.get("pickup_date", "")
        dropoff = args.get("dropoff_date", "")
        result = await self.tool.get(
            "/api/v1/fleet/search",
            pickup_location_id=location,
            dropoff_location_id=dropoff_location,
            pickup_date=pickup,
            dropoff_date=dropoff,
        )
        if not result.success:
            return json.dumps({"error": "could not search that location"}), None

        classes = [c for c in (result.data or {}).get("classes", []) if c.get("availableCount", 0) > 0]
        resolved_loc = (result.data or {}).get("resolved_location_id")
        ctx["last_search"] = {
            "location": location,
            "dropoff_location": dropoff_location,
            "resolved_location_id": resolved_loc,
            "pickup_date": pickup,
            "dropoff_date": dropoff,
            "classes": classes,
        }

        if not classes:
            return json.dumps({"available": [], "note": "no vehicles available for those dates"}), None

        summary = [
            {
                "vehicle_class_id": c.get("classId"),
                "name": c.get("className"),
                "daily_rate": c.get("baseDailyRate"),
                "currency": c.get("currencyCode", "USD"),
                "available": c.get("availableCount"),
            }
            for c in classes
        ]
        card = self._build_vehicle_card(classes, pickup, dropoff, location)
        return json.dumps({"available": summary}), card

    @staticmethod
    def _build_vehicle_card(classes: list, pickup: str, dropoff: str, location: str) -> dict:
        return {
            "kind": "vehicle_class_list",
            "data": {
                "classes": [
                    {
                        "class_id": c.get("classId"),
                        "class_code": c.get("classCode", ""),
                        "class_name": c.get("className"),
                        "description": c.get("description", ""),
                        "features": c.get("features", []),
                        "available_count": c.get("availableCount"),
                        "daily_rate": c.get("baseDailyRate", 0.0),
                        "currency_code": c.get("currencyCode", "USD"),
                    }
                    for c in classes
                ],
                "pickup_date": pickup,
                "dropoff_date": dropoff,
                "pickup_location": location,
            },
        }

    async def _t_get_quote(self, args: dict, ctx: dict) -> tuple[str, dict | None]:
        search = ctx.get("last_search") or {}
        class_id = args.get("vehicle_class_id") or ctx.get("selected_class_id")
        if not class_id or not search:
            return json.dumps({"error": "search for a vehicle first"}), None

        selected = next(
            (c for c in search.get("classes", []) if c.get("classId") == class_id),
            None,
        )
        class_name = selected.get("className") if selected else class_id
        ctx["selected_class_id"] = class_id
        ctx["selected_class_name"] = class_name

        result = await self.tool.post("/api/v1/pricing/quote", {
            "location_id": search.get("resolved_location_id") or search.get("location"),
            "vehicle_class_id": class_id,
            "pickup_dt": f"{search['pickup_date']}T10:00:00+00:00",
            "dropoff_dt": f"{search['dropoff_date']}T10:00:00+00:00",
            "extras": [],
            "currency": "USD",
        })
        if not result.success:
            return json.dumps({"error": "could not price that vehicle"}), None

        data = result.data
        ctx["quote_token"] = data.get("quote_token")
        ctx["quote_total"] = float(data.get("total", 0))

        card = {
            "kind": "quote_summary",
            "data": {
                "vehicle_class_name": class_name,
                "pickup_date": search["pickup_date"],
                "dropoff_date": search["dropoff_date"],
                "rental_days": float(data.get("rental_days", 1)),
                "daily_rate": float(selected.get("baseDailyRate", 0)) if selected else 0.0,
                "subtotal": float(data.get("subtotal", data.get("total", 0))),
                "taxes": float(data.get("taxes", 0)),
                "total": float(data.get("total", 0)),
                "currency": data.get("currency", "USD"),
                "quote_token": data.get("quote_token"),
                "line_items": [
                    {"description": li.get("description", ""), "amount": float(li.get("amount", 0))}
                    for li in (data.get("line_items") or [])
                ],
                "is_estimate": False,
            },
        }
        return json.dumps({
            "vehicle_class": class_name,
            "total": data.get("total"),
            "currency": data.get("currency", "USD"),
            "rental_days": data.get("rental_days"),
        }), card

    async def _t_lookup_reservation(self, args: dict, ctx: dict) -> tuple[str, dict | None]:
        conf = (args.get("confirmation_number") or "").upper()
        result = await self.tool.get("/api/v1/reservations", confirmation_number=conf)
        data = result.data
        if result.success and isinstance(data, list) and data:
            data = data[0]
        elif result.success and isinstance(data, dict) and (data.get("items") or data.get("reservations")):
            items = data.get("items") or data.get("reservations")
            data = items[0]
        else:
            return json.dumps({"found": False}), None

        ctx["reservation_id"] = data.get("reservation_id")
        ctx["confirmation_number"] = conf
        card = {
            "kind": "reservation_detail",
            "data": {
                "reservation_id": data.get("reservation_id", ""),
                "confirmation_number": data.get("confirmation_number", conf),
                "status": data.get("status", "UNKNOWN"),
                "pickup_date": str(data.get("pickup_datetime") or data.get("pickup_dt", "")),
                "dropoff_date": str(data.get("return_datetime") or data.get("dropoff_dt", "")),
                "pickup_location": str(data.get("pickup_location_id", "")),
                "vehicle_class": str(data.get("vehicle_class_name", data.get("vehicle_class_id", ""))),
            },
        }
        return json.dumps({
            "found": True,
            "confirmation_number": data.get("confirmation_number", conf),
            "status": data.get("status"),
            "pickup": str(data.get("pickup_datetime") or data.get("pickup_dt", "")),
            "dropoff": str(data.get("return_datetime") or data.get("dropoff_dt", "")),
        }), card

    async def _t_preview_cancellation(self, ctx: dict) -> tuple[str, dict | None]:
        res_id = ctx.get("reservation_id")
        if not res_id:
            return json.dumps({"error": "look up the reservation first"}), None
        result = await self.tool.get(f"/api/v1/reservations/{res_id}/cancellation-preview")
        if not result.success:
            return json.dumps({"error": "could not load cancellation details"}), None
        d = result.data
        card = {
            "kind": "cancellation_preview",
            "data": {
                "reservation_id": res_id,
                "confirmation_number": ctx.get("confirmation_number"),
                "cancellation_fee": d.get("cancellation_fee", 0),
                "refund_amount": d.get("refund_amount", 0),
                "policy_name": d.get("policy_name", "standard"),
            },
        }
        return json.dumps({
            "cancellation_fee": d.get("cancellation_fee", 0),
            "refund_amount": d.get("refund_amount", 0),
            "policy": d.get("policy_name", "standard"),
        }), card

    async def _t_cancel_reservation(self, args: dict, ctx: dict) -> tuple[str, dict | None]:
        res_id = ctx.get("reservation_id")
        if not res_id:
            return json.dumps({"error": "look up the reservation first"}), None
        result = await self.tool.post(
            f"/api/v1/reservations/{res_id}/cancel",
            {"reason": args.get("reason", "Customer requested via AI assistant"), "initiated_by": "CUSTOMER"},
        )
        if not result.success:
            return json.dumps({"error": "cancellation failed"}), None
        conf = ctx.get("confirmation_number", "")
        ctx["reservation_id"] = None
        return json.dumps({"cancelled": True, "confirmation_number": conf}), None

    async def _t_create_reservation(self, args: dict, ctx: dict) -> tuple[str, dict | None]:
        search = ctx.get("last_search") or {}
        class_id = args.get("vehicle_class_id") or ctx.get("selected_class_id")
        payload = {
            "guest_info": {
                "first_name": args.get("first_name", ""),
                "last_name": args.get("last_name", ""),
                "email": args.get("email", ""),
                **({"phone": args["phone"]} if args.get("phone") else {}),
            },
            "vehicle_class_id": class_id,
            "pickup_location": search.get("location"),
            "dropoff_location": search.get("dropoff_location") or search.get("location"),
            "pickup_date": search.get("pickup_date"),
            "dropoff_date": search.get("dropoff_date"),
            "extras": [],
        }
        result = await self.tool.post("/api/v1/reservations/guest", payload)
        if not result.success:
            detail = result.data.get("detail", "") if isinstance(result.data, dict) else ""
            return json.dumps({"error": detail or "booking failed"}), None
        conf = result.data.get("confirmation_number", "")
        ctx["confirmation_number"] = conf
        return json.dumps({"booked": True, "confirmation_number": conf}), None
