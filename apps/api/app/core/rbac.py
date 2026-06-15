from __future__ import annotations

import asyncio
import uuid
from typing import Callable, FrozenSet, Optional

from fastapi import Depends, HTTPException, Request, status

from app.core.security import UserClaims, get_current_user

# In-memory permission cache: role → frozenset of "resource:action" strings
_PERMISSION_MATRIX: dict[str, FrozenSet[str]] = {}
_MATRIX_LOCK = asyncio.Lock()


async def load_permission_matrix() -> None:
    """
    Called once from lifespan startup.
    Loads the permission matrix from staff_roles.permissions_json into memory.
    Also callable via /api/v1/admin/rbac/reload (SUPER_ADMIN only).
    """
    global _PERMISSION_MATRIX
    from app.core.database import AsyncSessionLocal
    from sqlalchemy import text

    async with _MATRIX_LOCK:
        try:
            async with AsyncSessionLocal() as session:
                rows = await session.execute(
                    text("SELECT role_name, permissions_json FROM staff_roles")
                )
                new_matrix: dict[str, FrozenSet[str]] = {}
                for role_name, permissions in rows:
                    new_matrix[role_name] = frozenset(permissions or [])
                _PERMISSION_MATRIX = new_matrix
        except Exception:
            # On startup the table may not exist yet (fresh install before migrations).
            # Log and continue — endpoints will fail with 403 until matrix is loaded.
            import structlog
            log = structlog.get_logger()
            log.warning(
                "rbac_matrix_load_failed",
                reason="staff_roles table may not exist yet; run migrations first",
            )


def _has_permission(role: str, resource: str, action: str) -> bool:
    permissions = _PERMISSION_MATRIX.get(role, frozenset())
    return f"{resource}:{action}" in permissions or f"{resource}:*" in permissions


def _has_location_access(claims: UserClaims, location_id: Optional[uuid.UUID]) -> bool:
    """
    Global-scope roles (SYSTEM_ADMIN, SUPER_ADMIN, FLEET_MANAGER, FINANCE,
    REGIONAL_MANAGER) have empty location_ids lists — they see all locations.
    Location-scoped roles have an explicit list.
    """
    if not claims.location_ids:
        return True   # Global scope
    if location_id is None:
        return True   # Request is not location-specific
    return location_id in claims.location_ids


def require_permission(
    resource: str,
    action: str,
    location_id_param: Optional[str] = None,
) -> Callable:
    """
    Factory that returns a FastAPI dependency enforcing role permission AND
    optional location scope.

    Args:
        resource:          The resource name, e.g. "fleet", "reservations"
        action:            The action, e.g. "read", "create", "update", "delete"
        location_id_param: If provided, the name of a path/query parameter containing
                           a location UUID to check against the user's location scope.

    Usage:
        @router.get("/{vehicle_id}")
        async def get_vehicle(
            vehicle_id: UUID,
            claims: UserClaims = Depends(require_permission("fleet", "read")),
        ): ...
    """
    async def _dependency(
        request: Request,
        claims: UserClaims = Depends(get_current_user),
    ) -> UserClaims:
        # Check role permission — any matching role is sufficient
        has_perm = any(
            _has_permission(role, resource, action) for role in claims.roles
        )
        if not has_perm:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "type":   "https://errors.rcm.app/permission-denied",
                    "title":  "Permission Denied",
                    "status": 403,
                    "detail": (
                        f"Role(s) {claims.roles} cannot perform '{action}' on '{resource}'"
                    ),
                },
            )

        # Check location scope (if applicable)
        if location_id_param:
            raw_loc = (
                request.path_params.get(location_id_param)
                or request.query_params.get(location_id_param)
            )
            if raw_loc:
                try:
                    loc_uuid = uuid.UUID(raw_loc)
                except ValueError:
                    loc_uuid = None
                if loc_uuid and not _has_location_access(claims, loc_uuid):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail={
                            "type":   "https://errors.rcm.app/location-scope-denied",
                            "title":  "Location Access Denied",
                            "status": 403,
                            "detail": f"User does not have access to location {raw_loc}",
                        },
                    )

        return claims

    return _dependency
