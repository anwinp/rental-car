"""How a tenant configures the way its storefront looks.

Draft and publish, the same shape the payment config settled on. `PUT` only
ever touches `draft_settings` — an operator can leave a half-finished colour
choice sitting there without it reaching a single customer. `POST /publish` is
the one write that copies the draft across, and is the only thing the public
storefront ever reads.

Logo and favicon are uploaded here, not linked. `theme.assets` decodes,
validates and re-encodes every image before it reaches storage — see that
module for why a tenant-supplied URL was never on the table for this.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import structlog
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session
from app.core.rbac import require_permission
from app.core.security import UserClaims
from app.domains.theme import fonts as font_registry
from app.domains.theme import presets

log = structlog.get_logger()
router = APIRouter()

_MAX_TEXT = 200
_MAX_LONG_TEXT = 400


# ── shapes ───────────────────────────────────────────────────────────────────

class ThemeSettings(BaseModel):
    """The tenant's overrides on top of whatever `preset` supplies.

    Every field here is optional and independently validated — never merged
    into CSS as-is. `presets.render_css` re-validates all of it again at
    publish time regardless of what passed here, so a row edited directly in
    the database cannot become a CSS injection vector either.
    """
    brand_hex: str | None = None
    # The rest of the storefront's canvas — previously fixed by the template
    # alone. Each is independent: a tenant can give the header its own colour
    # without touching the page background, or vice versa. All four pass
    # through presets.clamp_to_dark at render time, which is why validation
    # here only checks the *shape* of the value (a real hex colour) and not
    # how light it is — the darkening happens once, at the point that also
    # has to derive the surface scale and the readable foreground, not here.
    background_hex: str | None = None
    surface_hex: str | None = None
    navbar_hex: str | None = None
    footer_hex: str | None = None
    heading_font: str | None = None
    body_font: str | None = None
    radius_px: int | None = Field(default=None, ge=0, le=999)
    button_style: str | None = Field(default=None, pattern="^(solid|pill|square)$")

    hero_heading: str | None = Field(default=None, max_length=_MAX_TEXT)
    hero_subheading: str | None = Field(default=None, max_length=_MAX_LONG_TEXT)

    terms_url: str | None = Field(default=None, max_length=_MAX_TEXT)
    privacy_url: str | None = Field(default=None, max_length=_MAX_TEXT)
    support_phone: str | None = Field(default=None, max_length=40)
    support_email: str | None = Field(default=None, max_length=_MAX_TEXT)

    @field_validator("brand_hex", "background_hex", "surface_hex", "navbar_hex", "footer_hex")
    @classmethod
    def _validate_hex(cls, v: str | None) -> str | None:
        if v is not None and not presets.is_hex_colour(v):
            raise ValueError("Must be a 6-digit hex colour like #3b82f6.")
        return v

    @field_validator("heading_font", "body_font")
    @classmethod
    def _validate_font(cls, v: str | None) -> str | None:
        if v is not None and font_registry.get(v) is None:
            raise ValueError(f"'{v}' is not a font in the library.")
        return v

    @field_validator("terms_url", "privacy_url")
    @classmethod
    def _validate_url(cls, v: str | None) -> str | None:
        if v and not (v.startswith("https://") or v.startswith("http://")):
            raise ValueError("Links must start with https://.")
        return v


class DraftIn(BaseModel):
    preset: str
    settings: ThemeSettings = Field(default_factory=ThemeSettings)

    @field_validator("preset")
    @classmethod
    def _validate_preset(cls, v: str) -> str:
        if presets.get(v) is None:
            raise ValueError(f"'{v}' is not a template in the library.")
        return v


class ThemeOut(BaseModel):
    preset: str
    settings: dict[str, Any]
    published_preset: str | None = None
    published_settings: dict[str, Any] | None = None
    published_at: datetime | None = None
    is_published: bool
    logo_url: str | None = None
    logo_dark_url: str | None = None
    favicon_url: str | None = None
    preview_css: str
    published_css: str | None = None
    # Which colour(s) in the *draft* got darkened to stay legible, so the UI
    # can say "we darkened that a touch" rather than the tenant wondering why
    # the preview doesn't quite match what they typed.
    adjusted: list[str] = Field(default_factory=list)


class UploadOut(BaseModel):
    url: str


# ── helpers ──────────────────────────────────────────────────────────────────

async def _row(session: AsyncSession, tenant_id: str) -> dict:
    row = (
        await session.execute(
            text(
                "SELECT th.preset, th.draft_settings, th.settings, "
                "       th.published_preset, th.published_at, "
                "       th.logo_dark_url, th.favicon_url, t.logo_url "
                "  FROM tenants t "
                "  LEFT JOIN tenant_theme th ON th.tenant_id = t.tenant_id "
                " WHERE t.tenant_id = CAST(:t AS uuid)"
            ),
            {"t": tenant_id},
        )
    ).mappings().first()
    if not row:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No such workspace.")
    return dict(row)


def _to_out(row: dict) -> ThemeOut:
    preset = row["preset"] or "meridian"
    draft = row["draft_settings"] or {}
    published = row["settings"]
    draft_result = presets.render_theme(preset, **_css_kwargs(draft))
    published_css = (
        presets.render_css(row["published_preset"] or preset, **_css_kwargs(published))
        if published is not None else None
    )
    return ThemeOut(
        preset=preset,
        settings=draft,
        published_preset=row["published_preset"],
        published_settings=published,
        published_at=row["published_at"],
        is_published=published is not None,
        logo_url=row["logo_url"],
        logo_dark_url=row["logo_dark_url"],
        favicon_url=row["favicon_url"],
        preview_css=draft_result.css,
        published_css=published_css,
        adjusted=list(draft_result.adjusted),
    )


def _css_kwargs(settings: dict | None) -> dict:
    s = settings or {}
    return {
        "brand_hex": s.get("brand_hex"),
        "background_hex": s.get("background_hex"),
        "surface_hex": s.get("surface_hex"),
        "navbar_hex": s.get("navbar_hex"),
        "footer_hex": s.get("footer_hex"),
        "heading_font": s.get("heading_font"),
        "body_font": s.get("body_font"),
        "radius_px": s.get("radius_px"),
        "button_style": s.get("button_style"),
    }


# ── endpoints ────────────────────────────────────────────────────────────────

@router.get("/templates", summary="The template gallery and font library")
async def list_templates() -> dict:
    return {"templates": presets.describe(), "fonts": font_registry.describe()}


@router.get("", response_model=ThemeOut, summary="Current theme, draft and published")
async def get_theme(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ThemeOut:
    return _to_out(await _row(session, str(claims.tenant_id)))


@router.put("", response_model=ThemeOut, summary="Save the draft — does not go live")
async def put_theme(
    body: DraftIn,
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ThemeOut:
    settings_json = body.settings.model_dump(exclude_none=True)
    await session.execute(
        text(
            """
            INSERT INTO tenant_theme (tenant_id, preset, draft_settings, updated_by, updated_at)
            VALUES (CAST(:t AS uuid), :preset, CAST(:settings AS jsonb), :by, now())
            ON CONFLICT (tenant_id) DO UPDATE SET
                preset = EXCLUDED.preset,
                draft_settings = EXCLUDED.draft_settings,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
            """
        ),
        {
            "t": str(claims.tenant_id), "preset": body.preset,
            "settings": _json(settings_json), "by": str(claims.user_id),
        },
    )
    await session.commit()
    return _to_out(await _row(session, str(claims.tenant_id)))


@router.post("/publish", response_model=ThemeOut, summary="Make the draft live")
async def publish_theme(
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> ThemeOut:
    result = await session.execute(
        text(
            """
            UPDATE tenant_theme
               SET settings = draft_settings,
                   published_preset = preset,
                   published_at = now(),
                   updated_at = now()
             WHERE tenant_id = CAST(:t AS uuid)
             RETURNING tenant_id
            """
        ),
        {"t": str(claims.tenant_id)},
    )
    if result.rowcount == 0:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Choose a template and save it before publishing.",
        )
    await session.commit()
    log.info("theme_published", tenant_id=str(claims.tenant_id))
    return _to_out(await _row(session, str(claims.tenant_id)))


async def _upload(
    file: UploadFile, *, kind: str, session: AsyncSession, claims: UserClaims,
) -> str:
    from app.domains.theme.assets import InvalidImage, process_favicon, process_logo

    data = await file.read()
    try:
        processed = process_logo(data) if kind != "favicon" else process_favicon(data)
    except InvalidImage as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc

    from app.core.config import settings as app_settings
    from app.core.s3 import get_s3_client

    key = f"branding/{claims.tenant_id}/{kind}-{uuid.uuid4()}.png"
    try:
        get_s3_client().put_object(
            Bucket=app_settings.s3_photos_bucket, Key=key,
            Body=processed, ContentType="image/png",
        )
    except Exception as exc:  # noqa: BLE001
        log.error("theme_asset_upload_failed", kind=kind, error=str(exc)[:200])
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Storage is unavailable."
        ) from exc

    url = f"{app_settings.s3_public_endpoint}/{app_settings.s3_photos_bucket}/{key}"

    if kind == "logo":
        await session.execute(
            text("UPDATE tenants SET logo_url = :u, updated_at = now() "
                 " WHERE tenant_id = CAST(:t AS uuid)"),
            {"u": url, "t": str(claims.tenant_id)},
        )
    else:
        column = "logo_dark_url" if kind == "logo_dark" else "favicon_url"
        await session.execute(
            text(
                f"""
                INSERT INTO tenant_theme (tenant_id, {column}, updated_by, updated_at)
                VALUES (CAST(:t AS uuid), :u, :by, now())
                ON CONFLICT (tenant_id) DO UPDATE SET
                    {column} = EXCLUDED.{column}, updated_by = EXCLUDED.updated_by,
                    updated_at = now()
                """
            ),
            {"t": str(claims.tenant_id), "u": url, "by": str(claims.user_id)},
        )
    await session.commit()
    log.info("theme_asset_uploaded", tenant_id=str(claims.tenant_id), kind=kind)
    return url


@router.post("/logo", response_model=UploadOut, summary="Upload the primary logo")
async def upload_logo(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> UploadOut:
    return UploadOut(url=await _upload(file, kind="logo", session=session, claims=claims))


@router.post("/logo-dark", response_model=UploadOut,
             summary="Upload a variant for dark-on-light placements")
async def upload_logo_dark(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> UploadOut:
    return UploadOut(url=await _upload(file, kind="logo_dark", session=session, claims=claims))


@router.post("/favicon", response_model=UploadOut, summary="Upload the browser-tab icon")
async def upload_favicon(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
    claims: UserClaims = Depends(require_permission("admin", "config")),
) -> UploadOut:
    return UploadOut(url=await _upload(file, kind="favicon", session=session, claims=claims))


def _json(value: Any) -> str:
    import json
    return json.dumps(value)
