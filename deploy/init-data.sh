#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# RCM data initialisation (run ONCE, after `up -d` brings the stack online).
#
#   schema (47 alembic migrations, incl. extensions) -> inventory seed
#   -> realistic seed -> MinIO buckets
#
# Run from the REPO ROOT:   bash deploy/init-data.sh
# Re-runnable: migrations are idempotent; the realistic seed truncates+rebuilds
# its tables; bucket creation ignores "already exists".
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")/.."          # repo root

DC="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"

# Load env (POSTGRES_*, DIRECT_DATABASE_URL, AWS_*/S3_*) into this shell
set -a; source deploy/.env.prod; set +a

echo "▶ 1/4  Waiting for Postgres to be healthy…"
until $DC exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2; echo "   …still waiting"
done
echo "   ✓ Postgres ready"

echo "▶ 2/4  Running Alembic migrations (DIRECT connection, bypassing pgbouncer)…"
# DDL + advisory locks must NOT go through transaction-pooled pgbouncer, and
# creating RLS policies requires ownership — so this runs as the OWNER, which is
# the only thing that should ever use those credentials.
#
# APP_DB_PASSWORD must be forwarded: migration 052 creates the runtime role with
# it, and refuses to run in production if it is unset rather than falling back
# to the development password committed in this repository.
if [ -z "${APP_DB_PASSWORD:-}" ]; then
  echo "   ✗ APP_DB_PASSWORD is not set in deploy/.env.prod." >&2
  echo "     The application connects as app_user, not as the schema owner —" >&2
  echo "     an owner connection bypasses row-level security and silently" >&2
  echo "     disables tenant isolation. Set it and re-run." >&2
  exit 1
fi
$DC run --rm \
  -e DATABASE_URL="$DIRECT_DATABASE_URL" \
  -e APP_DB_PASSWORD="$APP_DB_PASSWORD" \
  api alembic upgrade head
echo "   ✓ schema at head (extensions, partman, pg_cron all created by migration 001)"

echo "▶ 3/4  Seeding data…"
# The tenant row must exist before anything else: every seeded table carries a
# tenant_id FK to it. Neither seed script creates it (in local dev it was made
# by hand), so bootstrap it here. Idempotent.
echo "   • tenant row ${TENANT_ID}"
$DC exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<SQL
INSERT INTO tenants (
  tenant_id, slug, legal_name, primary_email,
  billing_address, default_currency, default_timezone,
  subscription_tier, status, tos_accepted_at
) VALUES (
  '${TENANT_ID}', 'test-rental-co', 'Test Rental Co', 'admin@test.com',
  '{"street":"123 Main St","city":"Los Angeles","state":"CA","zip":"90001","country":"US"}',
  'USD', 'America/New_York', 'ENTERPRISE', 'ACTIVE', now()
) ON CONFLICT (tenant_id) DO NOTHING;
SQL

echo "   • seed_inventory.sql (locations, vehicle classes, base fleet)"
$DC exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  < apps/api/seed_inventory.sql

echo "   • seed_staff_bootstrap.sql (the 12 accounts seed_realistic.py assumes exist)"
$DC exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  < deploy/seed_staff_bootstrap.sql

echo "   • seed_realistic.py (customers, reservations, rentals, payments…)"
# The script hard-codes a local DSN; rewrite it to target the in-cluster DB.
TMP_SEED="$(mktemp)"
sed "s#^DSN = .*#DSN = \"postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}\"#" \
  apps/api/seed_realistic.py > "$TMP_SEED"
# mktemp gives 0600 owned by root; the api image runs as a non-root user and
# would get EACCES on the bind mount. Make it world-readable.
chmod 644 "$TMP_SEED"
$DC run --rm -T -v "$TMP_SEED":/seed.py:ro api python /seed.py
rm -f "$TMP_SEED"
echo "   ✓ data seeded (tenant ${TENANT_ID})"

echo "▶ 4/4  Creating buckets on RCM's own MinIO (rcm-minio)…"
# Run mc *inside* rcm-minio (the image ships it) — no extra container and no
# dependency on the compose network's generated name. The shared
# workforce-minio is never contacted.
docker exec rcm-minio mc alias set local http://127.0.0.1:9000 \
  "${AWS_ACCESS_KEY_ID}" "${AWS_SECRET_ACCESS_KEY}" >/dev/null

for b in "${S3_DOCUMENTS_BUCKET}" "${S3_PHOTOS_BUCKET}" "${S3_REPORTS_BUCKET}"; do
  docker exec rcm-minio mc mb --ignore-existing "local/$b"
done

# Browser PUTs to presigned URLs are cross-origin (app subdomain -> files.*),
# so the buckets need CORS. Older mc builds lack `mc cors`; MinIO's default
# policy is permissive, so a failure here is a warning, not a hard error.
docker exec -i rcm-minio sh -c 'cat > /tmp/cors.json' <<JSON
{ "CORSRules": [ {
  "AllowedOrigins": ["https://rcm.ceez.ai","https://admin.rcm.ceez.ai","https://counter.rcm.ceez.ai"],
  "AllowedMethods": ["PUT","GET","HEAD"],
  "AllowedHeaders": ["*"],
  "ExposeHeaders": ["ETag"]
} ] }
JSON
for b in "${S3_DOCUMENTS_BUCKET}" "${S3_PHOTOS_BUCKET}" "${S3_REPORTS_BUCKET}"; do
  docker exec rcm-minio mc cors set "local/$b" /tmp/cors.json 2>/dev/null \
    || echo "   ! CORS not set on $b (mc too old) — default MinIO policy applies"
done

# Tenant branding (logo, favicon) is rendered on every anonymous visit to a
# storefront, so it cannot be a presigned URL — those expire and a page cached
# by a browser for days would start 403ing. Anonymous READ is scoped to this
# one prefix only; the rest of rcm-photos (damage photos, signatures) stays
# private. Verified against production: the prefix serves 200 anonymously,
# a sibling prefix in the same bucket still 403s.
docker exec rcm-minio mc anonymous set download "local/${S3_PHOTOS_BUCKET}/branding"

echo "   buckets:" && docker exec rcm-minio mc ls local
echo "   ✓ buckets ready"

cat <<'EOF'

─────────────────────────────────────────────────────────────────────────────
 Data init complete. Object storage is RCM's own rcm-minio container
 (S3_ENDPOINT_URL=http://rcm-minio:9000); path-style + SigV4 are handled by
 apps/api/app/core/s3.py, and presigned URLs are signed against
 S3_PUBLIC_ENDPOINT so they resolve from the browser.
─────────────────────────────────────────────────────────────────────────────
EOF
