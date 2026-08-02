# ─── Stage 1: dependency builder ───────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

# Install build tools needed for some Python C extensions
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first — cached as long as requirements.txt doesn't change
COPY requirements.txt .

# Install into a prefix so we can copy cleanly
RUN pip install --prefix=/install --no-cache-dir -r requirements.txt


# ─── Stage 2: runtime image ────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

# Runtime-only system deps.
#
# libpq5 for asyncpg, curl for the health check, and the Pango/Cairo stack
# WeasyPrint binds to through cffi. Those were missing, so `import weasyprint`
# raised OSError on dlopen — which is how a PDF library sat in requirements.txt
# for a long time while nothing could render a page. The requirements file even
# carries a note pinning pydyf for a render bug "invisible until now because
# weasyprint was installed and never imported"; it was never imported because
# it could not be.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq5 \
    curl \
    libpango-1.0-0 \
    libpangoft2-1.0-0 \
    libharfbuzz0b \
    libcairo2 \
    libgdk-pixbuf-2.0-0 \
    libffi8 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Create non-root user (uid 1000, gid 1000)
RUN groupadd --gid 1000 appuser && \
    useradd --uid 1000 --gid appuser --shell /bin/bash --no-create-home appuser

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source — separate layer from deps
COPY --chown=appuser:appuser app/ ./app/
COPY --chown=appuser:appuser alembic/ ./alembic/
COPY --chown=appuser:appuser alembic.ini .

# Switch to non-root
USER appuser

EXPOSE 8000

# Health check — ECS uses this before registering with ALB target group
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=60s \
    CMD curl -f http://localhost:8000/health || exit 1

# Default command: Uvicorn with 4 workers
# WORKER_COUNT and PORT can be overridden via ECS task definition environment
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers ${WORKER_COUNT:-4} --loop uvloop --http httptools"]
