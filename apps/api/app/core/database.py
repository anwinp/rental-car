from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings

# PgBouncer runs in transaction-mode pooling as a sidecar.
# pool_size is small because PgBouncer manages the real connection pool.
engine = create_async_engine(
    settings.database_url.get_secret_value(),
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    pool_recycle=3600,
    echo=settings.env == "development",
)

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def dispose_engine() -> None:
    """Called from lifespan shutdown."""
    await engine.dispose()


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """Bare session — no GUC injection. Used by health check and Celery tasks."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_db(
    claims: "UserClaims",  # noqa: F821 — imported at call site to avoid circular
    request_id: str,
    client_ip: str,
    session: AsyncSession,
) -> AsyncGenerator[AsyncSession, None]:
    """
    Set all 5 PostgreSQL GUC session variables within this transaction.
    Must be called BEFORE any query that touches RLS-protected tables.

    The `true` third argument to set_config() scopes the value to the
    current transaction only — critical for connection-pool reuse safety.
    """
    await session.execute(
        text(
            "SELECT "
            "  set_config('app.current_tenant_id', :tid,  true), "
            "  set_config('app.current_user_id',   :uid,  true), "
            "  set_config('app.current_role',       :role, true), "
            "  set_config('app.client_ip',          :ip,   true), "
            "  set_config('app.request_id',         :rid,  true)"
        ),
        {
            "tid":  str(claims.tenant_id),
            "uid":  str(claims.user_id),
            "role": claims.primary_role,
            "ip":   client_ip,
            "rid":  request_id,
        },
    )
    yield session


async def check_db_health() -> bool:
    """Ping the database. Returns True on success, False on any error."""
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
