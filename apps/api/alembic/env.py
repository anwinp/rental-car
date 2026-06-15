from __future__ import annotations

import asyncio
import os
from logging.config import fileConfig
from typing import Any

from sqlalchemy import pool, MetaData
from sqlalchemy.ext.asyncio import async_engine_from_config
from alembic import context

config = context.config

# Override sqlalchemy.url from environment variable if set
database_url = os.environ.get("DATABASE_URL")
if database_url:
    config.set_main_option("sqlalchemy.url", database_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Naming convention for auto-generated constraint names
naming_convention: dict[str, Any] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Use MetaData with naming convention
# Domain model imports will be added here as domains are implemented
# from app.models import Base  # noqa: E402
# For now, use an empty MetaData — migrations are written manually per ARCH_DATABASE.md
target_metadata = MetaData(naming_convention=naming_convention)

# Partition table prefixes to exclude from autogenerate
_PARTITION_PREFIXES = ("audit_events_p", "telematics_events_p", "notification_log_p")


def include_object(
    obj: Any,
    name: str,
    type_: str,
    reflected: bool,
    compare_to: Any,
) -> bool:
    """Exclude auto-created partition child tables from autogenerate."""
    if type_ == "table":
        schema = getattr(obj, "schema", None) or "public"
        if schema in ("public", "audit", "archive"):
            return not any(name.startswith(p) for p in _PARTITION_PREFIXES)
    return True


_CTX_KWARGS: dict[str, Any] = dict(
    target_metadata=target_metadata,
    compare_type=True,
    compare_server_default=True,
    include_schemas=True,
    version_table_schema="public",
    render_as_batch=False,
    naming_convention=naming_convention,
    include_object=include_object,
)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (generate SQL without DB connection)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        transaction_per_migration=True,
        **_CTX_KWARGS,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Any) -> None:
    """Execute migrations against an open DB connection."""
    context.configure(
        connection=connection,
        transaction_per_migration=True,
        **_CTX_KWARGS,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    """Run migrations against a live async DB connection."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,  # Migrations run once; no pool needed
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
