from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx

from app.core.config import settings


@dataclass
class ToolResult:
    success: bool
    data: dict[str, Any]
    error_message: str | None = None
    status_code: int | None = None


class AgentTool:
    """
    HTTP wrapper for all agent-to-API calls.
    Uses Bearer auth so audit GUC injection runs correctly — never import
    service classes directly from agent code.
    """

    def __init__(self, agent_token: str, tenant_id: str, base_url: str | None = None):
        base_url = base_url or settings.agent_internal_api_url
        self._client = httpx.AsyncClient(
            base_url=base_url,
            headers={
                "Authorization": f"Bearer {agent_token}",
                "X-Tenant-ID": tenant_id,
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0),
        )

    async def get(self, path: str, **params: Any) -> ToolResult:
        return await self._call("GET", path, params=params)

    async def post(self, path: str, body: dict[str, Any]) -> ToolResult:
        return await self._call("POST", path, json=body)

    async def patch(self, path: str, body: dict[str, Any]) -> ToolResult:
        return await self._call("PATCH", path, json=body)

    async def _call(self, method: str, path: str, **kwargs: Any) -> ToolResult:
        try:
            resp = await self._client.request(method, path, **kwargs)
            if resp.is_success:
                try:
                    return ToolResult(success=True, data=resp.json(), status_code=resp.status_code)
                except Exception:
                    return ToolResult(success=True, data={}, status_code=resp.status_code)
            # 4xx — do not retry
            return ToolResult(
                success=False,
                data={},
                error_message=f"HTTP {resp.status_code}: {resp.text[:300]}",
                status_code=resp.status_code,
            )
        except httpx.TimeoutException:
            return ToolResult(success=False, data={}, error_message="TIMEOUT")
        except Exception as exc:
            return ToolResult(success=False, data={}, error_message=str(exc))

    async def aclose(self) -> None:
        await self._client.aclose()
