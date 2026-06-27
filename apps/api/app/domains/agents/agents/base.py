from __future__ import annotations

from abc import ABC, abstractmethod

from app.domains.agents.tool_wrapper import AgentTool


class BaseAgent(ABC):
    name: str = "base"

    def __init__(self, tool: AgentTool):
        self.tool = tool

    @abstractmethod
    async def handle(self, message: str, session: dict) -> dict:
        """
        Process a user message in the context of the given session.
        Returns a response dict: {"message": str, "card": dict|None, "chips": list[str]}
        """
