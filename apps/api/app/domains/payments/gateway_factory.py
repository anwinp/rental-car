from __future__ import annotations
from sqlalchemy.ext.asyncio import AsyncSession
from app.domains.payments.gateway import PaymentGateway


async def get_gateway_for_tenant(tenant_id: str, session: AsyncSession) -> PaymentGateway:
    from sqlalchemy import text
    result = await session.execute(
        text("SELECT payment_gateway FROM tenants WHERE tenant_id = CAST(:tid AS uuid)"),
        {"tid": tenant_id},
    )
    row = result.mappings().first()
    gateway_name = (row["payment_gateway"] if row else None) or "STRIPE"

    if gateway_name.upper() == "TYRO":
        from app.integrations.gateways.tyro_gateway import TyroGateway
        return TyroGateway()
    from app.integrations.gateways.stripe_gateway import StripeGateway
    return StripeGateway()
