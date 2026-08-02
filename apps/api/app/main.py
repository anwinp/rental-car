from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.database import dispose_engine
from app.core.exceptions import AppError, app_error_handler, sqlalchemy_integrity_error_handler
from app.core.middleware import RequestIDMiddleware, StructuredLoggingMiddleware
from app.core.observability import init_tracing
from app.core.rbac import load_permission_matrix
from app.core.redis import close_redis_pools, init_redis_pools

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Startup: init connections and permission cache. Shutdown: drain pools."""
    # Startup — wrap Redis ping in a timeout so a slow/absent Redis doesn't
    # prevent the server from starting. Cache features degrade gracefully.
    try:
        await asyncio.wait_for(init_redis_pools(), timeout=5.0)
    except (asyncio.TimeoutError, Exception) as exc:
        logger.warning("Redis startup ping failed (%s) — continuing without cache", exc)
    await load_permission_matrix()
    init_tracing(app)
    # Import all ORM models so SQLAlchemy metadata is fully populated before
    # any request handler runs. Prevents NoReferencedTableError when FK
    # resolution crosses domain boundaries (e.g. fleet → reservations → locations).
    _import_all_models()
    yield
    # Shutdown
    try:
        await asyncio.wait_for(close_redis_pools(), timeout=3.0)
    except Exception:
        pass
    await dispose_engine()


def _import_all_models() -> None:
    """Force-import every ORM model so SQLAlchemy metadata resolves all FK references."""
    import app.domains.auth.models  # noqa: F401
    import app.domains.tenants.models  # noqa: F401
    import app.domains.locations.models  # noqa: F401
    import app.domains.fleet.models  # noqa: F401
    import app.domains.reservations.models  # noqa: F401
    import app.domains.checkout.models  # noqa: F401
    import app.domains.customers.models  # noqa: F401
    import app.domains.pricing.models  # noqa: F401
    import app.domains.payments.models  # noqa: F401
    import app.domains.damage.models  # noqa: F401
    import app.domains.notifications.models  # noqa: F401
    import app.domains.channels.models  # noqa: F401
    import app.domains.tasks.models  # noqa: F401


def create_app() -> FastAPI:
    app = FastAPI(
        redirect_slashes=False,
        title="Rental Car Manager API",
        version="1.0.0",
        docs_url="/api/docs" if settings.env != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.env != "production" else None,
        generate_unique_id_function=lambda route: (
            f"{route.tags[0]}-{route.name}" if route.tags else route.name
        ),
        servers=[
            {"url": "https://api.rcm.app", "description": "Production"},
            {"url": "https://api.staging.rcm.app", "description": "Staging"},
            {"url": "http://localhost:8000", "description": "Local development"},
        ],
        lifespan=lifespan,
    )

    # ── Middleware stack (applied bottom-up; first-registered = outermost) ────
    # Execution order on request: CORS → StructuredLogging → RequestID → handler
    app.add_middleware(RequestIDMiddleware)
    app.add_middleware(StructuredLoggingMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Tenant-ID", "X-Request-ID", "Authorization"],
        expose_headers=["X-Request-ID"],
    )

    # ── Exception handlers ────────────────────────────────────────────────────
    app.add_exception_handler(AppError, app_error_handler)

    # SQLAlchemy integrity errors (23P01 exclusion, 23505 unique) mapped to AppError
    try:
        from sqlalchemy.exc import IntegrityError
        app.add_exception_handler(IntegrityError, sqlalchemy_integrity_error_handler)
    except ImportError:
        pass

    # ── Router registration ───────────────────────────────────────────────────
    from app.domains.auth.router         import router as auth_router
    from app.domains.tenants.router      import router as tenants_router
    from app.domains.catalogue.router import router as catalogue_router
    from app.domains.platform.tls_router import router as tls_router
    from app.domains.tenants.public_router import router as public_router
    from app.domains.platform.router       import router as platform_router
    from app.domains.tenants.features      import require_feature
    from app.domains.platform.auth_router  import router as platform_auth_router
    from app.domains.tenants.team_router   import router as team_router
    from app.domains.tenants.team_router   import public_router as invite_public_router
    from app.domains.locations.router    import router as locations_router
    from app.domains.fleet.router        import router as fleet_router
    from app.domains.reservations.router import router as res_router
    from app.domains.checkout.router     import router as checkout_router
    from app.domains.customers.router    import router as customers_router
    from app.domains.pricing.router      import router as pricing_router
    from app.domains.payments.router     import router as payments_router
    from app.domains.damage.router       import router as damage_router
    from app.domains.maintenance.router  import router as maintenance_router
    from app.domains.corporate.router    import router as corporate_router
    from app.domains.reporting.router    import router as reporting_router
    from app.domains.notifications.router import router as notifications_router
    from app.domains.channels.router     import router as channels_router
    from app.domains.admin.router        import router as admin_router
    from app.domains.billing.router      import router as billing_router
    from app.domains.dashboard.router   import router as dashboard_router
    from app.domains.tasks.router       import router as tasks_router
    from app.domains.agents.router      import router as agents_router

    PREFIX = "/api/v1"
    app.include_router(auth_router,           prefix=f"{PREFIX}/auth",          tags=["auth"])
    # Anonymous surface: sign-up and runtime config. Kept in its own
    # namespace so it is obvious in review which handlers may not trust
    # their input, and so the proxy can rate-limit it separately.
    app.include_router(catalogue_router,      prefix=f"{PREFIX}/catalogue",     tags=["catalogue"])
    app.include_router(tls_router,            prefix=f"{PREFIX}/internal",      tags=["internal"])
    app.include_router(public_router,         prefix=f"{PREFIX}/public",        tags=["public"])
    # Cross-tenant administration. Gated on membership of platform_admins, a
    # table with no tenant_id that no tenant-facing endpoint can write — see the
    # router docstring.
    #
    # The auth router carries its own /platform/auth prefix and mounts at the
    # API root, because the session cookie is scoped to path=/api/v1/platform
    # and a login endpoint the browser will not send the cookie back to is a
    # login endpoint that cannot refresh a session.
    app.include_router(platform_auth_router,  prefix=PREFIX,                    tags=["platform-auth"])
    app.include_router(platform_router,       prefix=f"{PREFIX}/platform",      tags=["platform"])
    # Team management for a workspace, and the public half of the invite flow
    # (accepting a link, before the invitee has any session).
    app.include_router(team_router,           prefix=f"{PREFIX}/team",          tags=["team"])
    app.include_router(invite_public_router,  prefix=f"{PREFIX}/public",        tags=["public"])
    app.include_router(tenants_router,        prefix=f"{PREFIX}/tenants",       tags=["tenants"])
    app.include_router(locations_router,      prefix=f"{PREFIX}/locations",     tags=["locations"])
    app.include_router(fleet_router,          prefix=f"{PREFIX}/fleet",         tags=["fleet"])
    app.include_router(res_router,            prefix=f"{PREFIX}/reservations",  tags=["reservations"])
    app.include_router(checkout_router,       prefix=f"{PREFIX}/checkout",      tags=["checkout"])
    app.include_router(customers_router,      prefix=f"{PREFIX}/customers",     tags=["customers"])
    app.include_router(pricing_router,        prefix=f"{PREFIX}/pricing",       tags=["pricing"])
    app.include_router(payments_router,       prefix=f"{PREFIX}/payments",      tags=["payments"])
    app.include_router(damage_router,         prefix=f"{PREFIX}/damage",        tags=["damage"])
    app.include_router(maintenance_router,    prefix=f"{PREFIX}/maintenance",   tags=["maintenance"])
    # Plan-gated surfaces. The gate sits on the mount rather than in each
    # handler so it is visible in the route table during review, and so an
    # endpoint added to one of these routers is covered the day it is
    # written rather than the day somebody notices.
    app.include_router(corporate_router,      prefix=f"{PREFIX}/corporate",     tags=["corporate"],
                       dependencies=[Depends(require_feature("corporate_accounts"))])
    app.include_router(reporting_router,      prefix=f"{PREFIX}/reporting",     tags=["reporting"],
                       dependencies=[Depends(require_feature("advanced_reporting"))])
    app.include_router(notifications_router,  prefix=f"{PREFIX}/notifications", tags=["notifications"])
    app.include_router(channels_router,       prefix=f"{PREFIX}/channels",      tags=["channels"],
                       dependencies=[Depends(require_feature("ota_channels"))])
    app.include_router(admin_router,          prefix=f"{PREFIX}/admin",         tags=["admin"])
    app.include_router(billing_router,        prefix=f"{PREFIX}/billing",       tags=["billing"])
    app.include_router(dashboard_router,      prefix=f"{PREFIX}/dashboard",     tags=["dashboard"])
    app.include_router(tasks_router,          prefix=f"{PREFIX}/tasks",          tags=["tasks"])
    app.include_router(agents_router,         prefix=f"{PREFIX}/agents",         tags=["agents"],
                       dependencies=[Depends(require_feature("agent_assistant"))])

    # Health check — no auth, no prefix (ALB health check target)
    from app.core.dependencies import health_router
    app.include_router(health_router)

    return app


app = create_app()
