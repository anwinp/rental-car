from __future__ import annotations

from app.domains.agents.agents.base import BaseAgent
from app.domains.agents.tool_wrapper import AgentTool


class EchoAgent(BaseAgent):
    """Foundation stub — echoes the user message back. Replaced in Wave 1."""

    name = "echo"

    def __init__(self, tool: AgentTool):
        super().__init__(tool)

    async def handle(self, message: str, session: dict) -> dict:
        return {
            "message": message,
            "card": None,
            "chips": ["Tell me your reservation number", "I need help with a return", "I have a question"],
        }
