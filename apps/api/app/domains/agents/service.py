from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from app.core.config import settings
from app.core.security import UserClaims, create_access_token
from app.domains.agents.agents.booking_concierge import BookingConcierge
from app.domains.agents.agents.echo import EchoAgent
from app.domains.agents.agents.reservation_manager import ReservationManager
from app.domains.agents.agents.damage_mediator import DamageMediator
from app.domains.agents.agents.return_advisor import ReturnAdvisor
from app.domains.agents.session_store import AgentSessionStore
from app.domains.agents.tool_wrapper import AgentTool

log = logging.getLogger(__name__)

# ── Intent keywords (rule-based fast-path) ────────────────────────────────────

_RESERVATION_KEYWORDS = frozenset({
    "reservation", "booking", "confirmation", "cancel", "cancellation",
    "modify", "change", "reschedule", "extend", "dates", "pickup", "drop",
    "rcm-", "book", "refund", "trip",
})

_DAMAGE_KEYWORDS = frozenset({
    "damage", "damaged", "scratch", "dent", "crack", "accident",
    "claim", "insurance", "collision", "windshield", "bumper",
    "repair", "loss of use", "lou", "deductible",
})

_RETURN_KEYWORDS = frozenset({
    "return", "returned", "charge", "charged", "fee", "overcharged",
    "mileage", "fuel", "late", "receipt", "bill", "statement",
    "dispute", "unfair", "wrong", "explain", "breakdown", "goodwill",
})

_BOOKING_KEYWORDS = frozenset({
    "rent", "reserve", "find", "search", "available", "price", "quote",
    "how much", "cheapest", "suv", "sedan", "economy", "class",
    "car", "vehicle", "need a car", "looking for", "pickup location",
    "pickup date", "drop off", "dropoff", "hire a car",
})


def _classify_intent_rules(message: str) -> str | None:
    """
    Rule-based fast-path intent classification.
    Returns agent name or None if ambiguous.
    """
    lower = message.lower()
    words = set(lower.split())

    res_score = sum(1 for kw in _RESERVATION_KEYWORDS if kw in lower)
    book_score = sum(1 for kw in _BOOKING_KEYWORDS if kw in lower)

    # Confirmation number pattern is unambiguous
    import re
    if re.search(r'\bRCM-\d{8}-[A-Z0-9]{6}\b', message, re.IGNORECASE):
        return "ReservationManager"

    ret_score = sum(1 for kw in _RETURN_KEYWORDS if kw in lower)
    dmg_score = sum(1 for kw in _DAMAGE_KEYWORDS if kw in lower)

    best = max(res_score, book_score, ret_score, dmg_score)
    if best < 2:
        return None  # ambiguous — needs Claude classification or greeting

    if res_score == best and res_score >= 2:
        return "ReservationManager"
    if book_score == best and book_score >= 2:
        return "BookingConcierge"
    if ret_score == best and ret_score >= 2:
        return "ReturnAdvisor"
    if dmg_score == best and dmg_score >= 2:
        return "DamageMediator"

    return None


async def _get_tenant_anthropic_key(tenant_id: str) -> str:
    """
    Look up per-tenant Anthropic API key. Falls back to system key from env.
    Returns empty string if neither is configured.
    """
    try:
        from sqlalchemy import select, text
        from app.core.database import AsyncSessionLocal
        from app.domains.tenants.models import Tenant

        async with AsyncSessionLocal() as session:
            result = await session.execute(
                select(Tenant.anthropic_api_key).where(Tenant.tenant_id == tenant_id)
            )
            row = result.scalar_one_or_none()
            if row:
                return row
    except Exception as exc:
        log.debug("tenant_key_lookup_failed tenant=%s error=%s", tenant_id, exc)

    # Fall back to system-wide key
    try:
        return settings.anthropic_api_key.get_secret_value()
    except Exception:
        return ""


async def _classify_intent_claude(message: str, api_key: str = "") -> str:
    """
    Claude-based classification for ambiguous messages.
    Only called when an API key is configured (tenant or system).
    Falls back to 'ReservationManager' on any error.
    """
    try:
        import anthropic
        client = anthropic.AsyncAnthropic(
            api_key=api_key or settings.anthropic_api_key.get_secret_value()
        )
        resp = await client.messages.create(
            model="claude-haiku-4-5-20251001",  # cheapest, lowest latency
            max_tokens=20,
            system=(
                "You are an intent classifier for a car rental company. "
                "Classify the user message into one of these agents: "
                "ReservationManager (modify/cancel existing reservations), "
                "BookingConcierge (new reservations/pricing), "
                "ReturnAdvisor (returns/charges), "
                "General (greetings/unclear). "
                "Reply with ONLY the agent name, nothing else."
            ),
            messages=[{"role": "user", "content": message}],
        )
        agent_name = resp.content[0].text.strip()
        valid = {"ReservationManager", "BookingConcierge", "ReturnAdvisor", "General"}
        return agent_name if agent_name in valid else "ReservationManager"
    except Exception as exc:
        log.warning("claude_classification_failed error=%s", exc)
        return "ReservationManager"


def _make_agent_token(tenant_id: str) -> str:
    """Create a short-lived JWT for agent tool calls to the API."""
    agent_uid = uuid.uuid5(uuid.UUID(tenant_id) if len(tenant_id) == 36 else uuid.UUID(int=0), "orchestrator")
    jti = str(uuid.uuid4())
    return create_access_token(
        user_id=agent_uid,
        tenant_id=uuid.UUID(tenant_id) if len(tenant_id) == 36 else uuid.UUID(int=0),
        roles=["AGENT_SERVICE"],
        primary_role="AGENT_SERVICE",
        location_ids=[],
        jti=jti,
        app_context="orchestrator",
    )


class AgentOrchestrator:
    """
    Wave 1 orchestrator: rule-based + Claude intent classification,
    routes to ReservationManager. BookingConcierge/ReturnAdvisor added in Waves 2–3.
    """

    def __init__(self, tenant_id: str, customer_claims: UserClaims | None = None):
        self.tenant_id = tenant_id
        self.customer_claims = customer_claims
        self._store = AgentSessionStore()

    async def handle(self, session_id: str | None, message: str) -> dict:
        # Resolve per-tenant API key (BYOK — checked once per handle call)
        api_key = await _get_tenant_anthropic_key(self.tenant_id) if self.tenant_id else ""

        # Resolve or create session
        session: dict | None = None
        if session_id:
            session = await self._store.get(session_id)
            if session and session.get("tenant_id") != self.tenant_id:
                session = None  # tenant mismatch — new session

        if session is None:
            customer_id = str(self.customer_claims.user_id) if self.customer_claims else None
            session = await self._store.create(
                tenant_id=self.tenant_id,
                customer_id=customer_id,
            )

        # Persist resolved key in session so sub-agents can use it
        session["anthropic_api_key"] = api_key

        # Record user message
        await self._store.append_message(session, role="user", content=message)

        # Route to the right agent
        agent = await self._resolve_agent(message, session, api_key=api_key)
        session["active_agent"] = agent.name

        # Build tool wrapper for agent HTTP calls
        token = _make_agent_token(self.tenant_id) if self.tenant_id else ""
        agent.tool = AgentTool(agent_token=token, tenant_id=self.tenant_id)

        response = await agent.handle(message, session)

        # Record assistant response
        await self._store.append_message(
            session,
            role="assistant",
            content=response["message"],
            agent=agent.name,
        )

        return {
            "session_id": session["session_id"],
            "message": response["message"],
            "card": response.get("card"),
            "chips": response.get("chips", []),
            "agent": agent.name,
        }

    async def _resolve_agent(self, message: str, session: dict, api_key: str = ""):
        # Preferred path: an LLM is configured → drive the whole conversation
        # with the tool-calling LLM agent instead of the rule-based scripts.
        if settings.llm_api_key.get_secret_value():
            from app.domains.agents.agents.llm_agent import LLMAgent
            return LLMAgent(tool=AgentTool("", self.tenant_id))

        active = session.get("active_agent")

        # Mid-conversation — stay with the active agent unless booking is complete
        if active == "ReservationManager" and session.get("context", {}).get("reservation_id"):
            return ReservationManager(tool=AgentTool("", self.tenant_id))
        if active == "BookingConcierge" and session.get("context", {}).get("booking_step") not in (None, "confirmed"):
            return BookingConcierge(tool=AgentTool("", self.tenant_id))
        if active == "ReturnAdvisor" and session.get("context", {}).get("return_step") not in (None, "resolved"):
            return ReturnAdvisor(tool=AgentTool("", self.tenant_id))
        if active == "DamageMediator" and session.get("context", {}).get("damage_claim_id"):
            return DamageMediator(tool=AgentTool("", self.tenant_id))

        # Classify intent
        intent = _classify_intent_rules(message)

        if intent is None:
            # Ambiguous — use Claude if a key is configured (tenant or system), else General
            effective_key = api_key or settings.anthropic_api_key.get_secret_value()
            if effective_key:
                intent = await _classify_intent_claude(message, api_key=effective_key)
            else:
                intent = "General"

        if intent == "ReservationManager":
            return ReservationManager(tool=AgentTool("", self.tenant_id))
        if intent == "BookingConcierge":
            return BookingConcierge(tool=AgentTool("", self.tenant_id))
        if intent == "ReturnAdvisor":
            return ReturnAdvisor(tool=AgentTool("", self.tenant_id))
        if intent == "DamageMediator":
            return DamageMediator(tool=AgentTool("", self.tenant_id))

        return EchoAgent(tool=AgentTool("", self.tenant_id))
