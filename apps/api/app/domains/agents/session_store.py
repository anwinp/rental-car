from __future__ import annotations

import json
from datetime import datetime, timezone
from uuid import uuid4

from app.core.config import settings
from app.core.redis import AGENT_SESSION_KEY, get_session_redis


class AgentSessionStore:
    async def create(self, tenant_id: str, customer_id: str | None) -> dict:
        session_id = str(uuid4())
        now = datetime.now(timezone.utc).isoformat()
        session = {
            "session_id": session_id,
            "tenant_id": tenant_id,
            "customer_id": customer_id,
            "active_agent": None,
            "created_at": now,
            "last_active": now,
            "messages": [],
            "context": {
                "reservation_id": None,
                "rental_agreement_id": None,
                "damage_claim_id": None,
                "resolved_issues": [],
            },
            "handoff_summary": None,
        }
        redis = get_session_redis()
        key = AGENT_SESSION_KEY.format(session_id=session_id)
        await redis.set(key, json.dumps(session), ex=settings.agent_session_ttl_seconds)
        return session

    async def get(self, session_id: str) -> dict | None:
        redis = get_session_redis()
        key = AGENT_SESSION_KEY.format(session_id=session_id)
        raw = await redis.get(key)
        if not raw:
            return None
        return json.loads(raw)

    async def update(self, session: dict) -> None:
        session["last_active"] = datetime.now(timezone.utc).isoformat()
        redis = get_session_redis()
        key = AGENT_SESSION_KEY.format(session_id=session["session_id"])
        await redis.set(key, json.dumps(session), ex=settings.agent_session_ttl_seconds)

    async def append_message(self, session: dict, role: str, content: str, agent: str | None = None) -> None:
        msg: dict = {
            "role": role,
            "content": content,
            "ts": datetime.now(timezone.utc).isoformat(),
        }
        if agent:
            msg["agent"] = agent
        session["messages"].append(msg)
        # Cap at 50 turns to bound Redis key size
        if len(session["messages"]) > 50:
            session["messages"] = session["messages"][-50:]
        await self.update(session)
