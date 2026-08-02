"""Catalogue management — a tenant's own vehicle classes and extras.

These tables used to hold global rows shared by every tenant, so there was
nothing to manage and no endpoints existed. Since migration 065 each workspace
owns its rows, and since 066 it can delete them without corrupting history —
but until this router there was still no way to do either through the product.
A tenant was stuck with the twelve classes it was seeded with, permanently.

Everything here is tenant-scoped by RLS: the queries carry no tenant predicate
because the session is already bound, and a row belonging to another workspace
is not visible to be read, changed or deleted.

Deleting is the interesting case. A class that is still fitted to vehicles
cannot simply vanish — those cars would have no class and could not be priced
or searched — so that is refused with an instruction rather than a constraint
error, and deactivation is offered instead. Everything else gives way: pricing
rows cascade, customer preferences null out, and past bookings keep the class
NAME they were sold under so history stays readable.
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.core.tenancy import require_tenant

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────────────────────

class VehicleClassIn(BaseModel):
    # The column is character(1) — a single SIPP letter (M, E, C, I, S, F…).
    sipp_prefix: str = Field(min_length=1, max_length=1)
    name: str = Field(min_length=1, max_length=80)
    description: Optional[str] = Field(default=None, max_length=500)
    sort_order: int = Field(default=99, ge=0, le=999)
    is_active: bool = True


class VehicleClassOut(BaseModel):
    class_id: uuid.UUID
    sipp_prefix: str
    name: str
    description: Optional[str] = None
    sort_order: Optional[int] = None
    is_active: bool
    vehicle_count: int
    reservation_count: int
    # False when vehicles are still fitted to it — the UI uses this to offer
    # deactivation instead of a delete that will be refused.
    can_delete: bool


class ExtraIn(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=80)
    extra_type: str = Field(default="EQUIPMENT", max_length=30)
    pricing_type: str = Field(default="PER_DAY", max_length=20)
    default_price: float = Field(ge=0)
    # NOT NULL in the schema; TAXABLE is what every seeded extra uses.
    tax_treatment: str = Field(default="TAXABLE", max_length=30)
    is_active: bool = True


class ExtraOut(BaseModel):
    extra_id: uuid.UUID
    code: str
    name: str
    extra_type: Optional[str] = None
    pricing_type: Optional[str] = None
    # Nullable in the data: some extras are priced per booking elsewhere.
    default_price: Optional[float] = None
    tax_treatment: Optional[str] = None
    is_active: bool


class SimpleResult(BaseModel):
    ok: bool = True
    message: str


# ── Vehicle classes ──────────────────────────────────────────────────────────

@router.get("/vehicle-classes", response_model=list[VehicleClassOut],
            summary="This workspace's vehicle classes")
async def list_vehicle_classes(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> list[VehicleClassOut]:
    rows = (
        await session.execute(
            text(
                """
                SELECT vc.class_id, vc.sipp_prefix, vc.name, vc.description,
                       vc.sort_order, vc.is_active,
                       (SELECT count(*) FROM vehicles v
                         WHERE v.vehicle_class_id = vc.class_id
                           AND v.tenant_id = :t)                      AS vehicle_count,
                       (SELECT count(*) FROM reservations r
                         WHERE r.vehicle_class_id = vc.class_id
                           AND r.tenant_id = :t)                      AS reservation_count
                  FROM vehicle_classes vc
                 WHERE vc.tenant_id = :t
                 ORDER BY vc.sort_order NULLS LAST, vc.name
                """
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().all()

    return [
        VehicleClassOut(**{**r, "can_delete": r["vehicle_count"] == 0})
        for r in rows
    ]


@router.post("/vehicle-classes", response_model=VehicleClassOut,
             status_code=status.HTTP_201_CREATED,
             summary="Add a vehicle class")
async def create_vehicle_class(
    body: VehicleClassIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "create")),
) -> VehicleClassOut:
    clash = (
        await session.execute(
            text("SELECT 1 FROM vehicle_classes WHERE upper(sipp_prefix) = upper(:s)"),
            {"s": body.sipp_prefix},
        )
    ).first()
    if clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You already have a class using the code '{body.sipp_prefix.upper()}'.",
        )

    class_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO vehicle_classes (class_id, tenant_id, sipp_prefix, name,
                                         description, sort_order, is_active,
                                         created_at, updated_at)
            VALUES (:id, :t, :sipp, :name, :descr, :sort, :active, now(), now())
            """
        ),
        {
            "id": str(class_id), "t": str(claims.tenant_id),
            "sipp": body.sipp_prefix.upper(), "name": body.name,
            "descr": body.description, "sort": body.sort_order,
            "active": body.is_active,
        },
    )
    await session.commit()
    return VehicleClassOut(
        class_id=class_id, sipp_prefix=body.sipp_prefix.upper(), name=body.name,
        description=body.description, sort_order=body.sort_order,
        is_active=body.is_active, vehicle_count=0, reservation_count=0,
        can_delete=True,
    )


@router.patch("/vehicle-classes/{class_id}", response_model=SimpleResult,
              summary="Rename or reconfigure a vehicle class")
async def update_vehicle_class(
    class_id: uuid.UUID,
    body: VehicleClassIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> SimpleResult:
    result = await session.execute(
        text(
            """
            UPDATE vehicle_classes
               SET sipp_prefix = upper(:sipp), name = :name,
                   description = :descr, sort_order = :sort,
                   is_active = :active, updated_at = now()
             WHERE class_id = :id AND tenant_id = :t
            """
        ),
        {
            "t": str(claims.tenant_id),
            "id": str(class_id), "sipp": body.sipp_prefix, "name": body.name,
            "descr": body.description, "sort": body.sort_order,
            "active": body.is_active,
        },
    )
    if result.rowcount == 0:
        # Not found, or owned by another workspace — indistinguishable on
        # purpose, so this cannot be used to probe for other tenants' ids.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such vehicle class.")
    await session.commit()
    return SimpleResult(message=f"Updated {body.name}.")


@router.delete("/vehicle-classes/{class_id}", response_model=SimpleResult,
               summary="Delete a vehicle class")
async def delete_vehicle_class(
    class_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "delete")),
) -> SimpleResult:
    row = (
        await session.execute(
            text(
                """
                SELECT vc.name,
                       (SELECT count(*) FROM vehicles v
                         WHERE v.vehicle_class_id = vc.class_id
                           AND v.tenant_id = :t) AS vehicles
                  FROM vehicle_classes vc
                 WHERE vc.class_id = :id AND vc.tenant_id = :t
                """
            ),
            {"id": str(class_id), "t": str(claims.tenant_id)},
        )
    ).mappings().first()

    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such vehicle class.")

    if row["vehicles"]:
        # Refused with an instruction rather than a raw constraint error. The
        # cars would otherwise be left unclassifiable — unpriceable and
        # unsearchable — which is worse than refusing.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{row['vehicles']} vehicle(s) are still in {row['name']}. Move them "
            "to another class first, or deactivate this class to stop offering "
            "it while keeping the vehicles where they are.",
        )

    await session.execute(
        text("DELETE FROM vehicle_classes WHERE class_id = :id AND tenant_id = :t"),
        {"id": str(class_id), "t": str(claims.tenant_id)},
    )
    await session.commit()
    return SimpleResult(
        message=f"Deleted {row['name']}. Past bookings still show it by name."
    )


# ── Extras ───────────────────────────────────────────────────────────────────

@router.get("/extras", response_model=list[ExtraOut],
            summary="This workspace's extras")
async def list_extras(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "read")),
) -> list[ExtraOut]:
    rows = (
        await session.execute(
            text(
                "SELECT extra_id, code, name, extra_type, pricing_type, "
                "       default_price, tax_treatment, is_active "
                "  FROM extras_catalog WHERE tenant_id = :t ORDER BY name"
            ),
            {"t": str(claims.tenant_id)},
        )
    ).mappings().all()
    return [ExtraOut(**r) for r in rows]


class PublicExtra(BaseModel):
    """An extra as the booking site needs it — id, label, price, nothing else."""
    extra_id: str
    code: str
    name: str
    pricing_type: Optional[str] = None
    default_price: Optional[float] = None


@router.get("/extras/public", response_model=list[PublicExtra],
            summary="Bookable extras (public — no auth, for the booking site)")
async def list_extras_public(
    session: AsyncSession = Depends(get_session),
    tenant_id: uuid.UUID = Depends(require_tenant),
) -> list[PublicExtra]:
    """Active extras for the public booking flow.

    The booking site had a hardcoded list of five extras with invented prices
    and used their CODE as the identifier. Both quote and reservation take
    `extra_id: UUID`, so every one of those selections was rejected — a customer
    could tick "Child Safety Seat", see a price, and have the booking fail with
    a validation error naming a field they never saw.

    Tenant comes from the hostname exactly as /locations/public does: no
    fallback, because an unresolvable tenant must be an error rather than some
    other company's price list.
    """
    # Priced extras only. The seeded catalogue ships every extra with a NULL
    # default_price, and the quote engine cannot charge for one — so listing it
    # would show a customer "$0.00 /day" against Collision Damage Waiver and
    # take the booking without ever billing it. An extra a workspace has not
    # priced is not yet for sale; it appears here the moment a price is set.
    rows = (
        await session.execute(
            text(
                "SELECT extra_id, code, name, pricing_type, default_price "
                "  FROM extras_catalog "
                " WHERE tenant_id = :t AND is_active "
                "   AND default_price IS NOT NULL AND default_price > 0 "
                " ORDER BY name"
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().all()
    return [
        PublicExtra(
            extra_id=str(r["extra_id"]),
            code=r["code"],
            name=r["name"],
            pricing_type=r["pricing_type"],
            default_price=float(r["default_price"]) if r["default_price"] is not None else None,
        )
        for r in rows
    ]


@router.post("/extras", response_model=ExtraOut,
             status_code=status.HTTP_201_CREATED, summary="Add an extra")
async def create_extra(
    body: ExtraIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "create")),
) -> ExtraOut:
    clash = (
        await session.execute(
            text("SELECT 1 FROM extras_catalog WHERE upper(code) = upper(:c)"),
            {"c": body.code},
        )
    ).first()
    if clash:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"You already have an extra with the code '{body.code.upper()}'.",
        )

    extra_id = uuid.uuid4()
    await session.execute(
        text(
            """
            INSERT INTO extras_catalog (extra_id, tenant_id, code, name,
                                        extra_type, pricing_type, default_price,
                                        tax_treatment, is_active,
                                        created_at, updated_at)
            VALUES (:id, :t, upper(:code), :name, :etype, :ptype, :price,
                    :tax, :active, now(), now())
            """
        ),
        {
            "id": str(extra_id), "t": str(claims.tenant_id), "code": body.code,
            "name": body.name, "etype": body.extra_type,
            "ptype": body.pricing_type, "price": body.default_price,
            "tax": body.tax_treatment, "active": body.is_active,
        },
    )
    await session.commit()
    return ExtraOut(extra_id=extra_id, code=body.code.upper(), **body.model_dump(
        exclude={"code"}))


@router.patch("/extras/{extra_id}", response_model=SimpleResult,
              summary="Update an extra")
async def update_extra(
    extra_id: uuid.UUID,
    body: ExtraIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "update")),
) -> SimpleResult:
    result = await session.execute(
        text(
            """
            UPDATE extras_catalog
               SET code = upper(:code), name = :name, extra_type = :etype,
                   pricing_type = :ptype, default_price = :price,
                   tax_treatment = :tax, is_active = :active, updated_at = now()
             WHERE extra_id = :id AND tenant_id = :t
            """
        ),
        {
            "t": str(claims.tenant_id),
            "id": str(extra_id), "code": body.code, "name": body.name,
            "etype": body.extra_type, "ptype": body.pricing_type,
            "price": body.default_price, "tax": body.tax_treatment,
            "active": body.is_active,
        },
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such extra.")
    await session.commit()
    return SimpleResult(message=f"Updated {body.name}.")


@router.delete("/extras/{extra_id}", response_model=SimpleResult,
               summary="Delete an extra")
async def delete_extra(
    extra_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("vehicles", "delete")),
) -> SimpleResult:
    result = await session.execute(
        text("DELETE FROM extras_catalog WHERE extra_id = :id AND tenant_id = :t"),
        {"id": str(extra_id), "t": str(claims.tenant_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such extra.")
    await session.commit()
    return SimpleResult(message="Extra deleted.")
