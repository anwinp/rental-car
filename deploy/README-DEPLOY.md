# Deploying RCM to `rcm.ceez.ai`

Single-VM deployment of the Rental Car Manager monorepo, alongside the existing
`workforce` stack, behind the shared `workforce-caddy` reverse proxy. No new
public ports — only Caddy stays exposed on 80/443, so the host firewall is
unchanged.

All files referenced live in `deploy/` plus a `Dockerfile` in each `apps/web-*`.

---

## 1. Topology

```
Internet ──443──> workforce-caddy ──(rcm_internal, by container name)──┐
                                                                       │
   rcm.ceez.ai          ──>  rcm-booking   (Next.js SSR, :3000)        │
   rcm-admin.ceez.ai    ──>  rcm-admin     (Vite SPA via nginx, :80)   │  + /api/v1/* ─> rcm-api
   rcm-counter.ceez.ai  ──>  rcm-counter   (Vite PWA via nginx, :80)   │  + /api/v1/* ─> rcm-api
   rcm-api.ceez.ai      ──>  rcm-api        (FastAPI, :8000)           │
   rcm-files.ceez.ai    ──>  rcm-minio      (RCM's own, :9000)         │
                                                                       │
   rcm_internal (private; caddy is attached, nothing else outside is):                                │
     rcm-postgres (pg16 + pg_cron + pg_partman)  rcm-pgbouncer         │
     rcm-redis-avail / -broker / -sessions                            │
     rcm-minio (own volume + credentials)                              │
     rcm-worker-notifications / -worker-reports / -beat ──────────────┘
```

Why each frontend also proxies `/api/v1`: the shared `@rcm/api-client` calls the
API at the **relative** path `/api/v1` with cookie auth (`credentials: 'include'`).
Serving the API same-origin under each subdomain avoids CORS and keeps cookies
first-party. The Next.js booking app does this itself (via `next.config.mjs`
rewrites); the two Vite SPAs rely on Caddy to split `/api/v1` off to `rcm-api`.

---

## 2. Prerequisites (one-time, on the VM)

There is no shared `edge` network on this host. The established pattern is one
private network per stack (`ceezstg_internal`, `ceez-staging_internal`, …) with
`workforce-caddy` attached to each. RCM follows it — `docker compose up` creates
`rcm_internal`, then attach Caddy to it:

```bash
docker network connect rcm_internal workforce-caddy
```

`docker network connect` on a running container takes effect immediately and
does not restart it. It is NOT persisted, though: if `workforce-caddy` is ever
recreated, re-run it, or persist it in the *ceez-ai-main* compose:

```yaml
  caddy:
    networks: [internal, rcm_internal]
networks:
  rcm_internal:
    external: true
```

---

## 3. DNS

Add records pointing at the VM's public IP (same IP as `workforce`):

| Record | Type | Value |
|--------|------|-------|
| `rcm.ceez.ai` | A | `<VM_IP>` |
| `rcm-admin.ceez.ai` | A | `<VM_IP>` |
| `rcm-counter.ceez.ai` | A | `<VM_IP>` |
| `rcm-api.ceez.ai` | A | `<VM_IP>` |
| `rcm-files.ceez.ai` | A | `<VM_IP>` |

Flat, hyphenated names (not nested `admin.rcm.ceez.ai`) — matching the existing
`netpulse-staging` / `ingest-staging` convention. Each is a single A record, and
each gets its own cert via HTTP-01. A nested scheme would tempt a wildcard, and
wildcards require DNS-01 with API credentials — avoided entirely here.

Caddy issues certs automatically on the first request per host, once the name
resolves publicly. Add DNS BEFORE adding a site block: requests for a
non-resolving name produce repeated ACME failures that count against Let's
Encrypt rate limits.

---

## 4. Secrets

```bash
cp deploy/.env.prod.example deploy/.env.prod
chmod 600 deploy/.env.prod
# Fill in real values. Generate strong ones:
openssl rand -hex 32   # DB password
openssl rand -hex 64   # JWT_SECRET_KEY
```

`deploy/.env.prod` is gitignored. The placeholders that MUST change are marked
`CHANGE_ME`. Stripe/Twilio/SendGrid/Avalara can start in sandbox/test mode.

---

## 5. Build & launch

```bash
# From the repo root. Frontends build in the monorepo (context = repo root).
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod up -d --build
```

This builds 4 images (api, booking, admin, counter), pulls postgres/redis/
pgbouncer/minio, and starts everything. Data layer comes up on `rcm-internal`;
api + frontends also join `edge`. `rcm-minio` sits on both — internal for the
API, edge so Caddy can serve `rcm-files.ceez.ai`.

> First build is slow (npm ci across the workspace). **Validate the frontend
> builds locally first** if you can — `npm ci && npm run build` at the repo root —
> since monorepo Docker builds are the most likely thing to need a tweak.

---

## 6. Initialise the database + storage

```bash
bash deploy/init-data.sh
```

Runs, in order: the 47 Alembic migrations (which create the `uuid-ossp`,
`btree_gist`, `pgcrypto`, `pg_partman`, and `pg_cron` extensions) → `seed_inventory.sql`
→ `seed_realistic.py` → MinIO bucket creation. Migrations run on a **direct**
Postgres connection (not through pgbouncer's transaction pooling, which breaks
DDL/advisory locks).

---

## 7. Wire up Caddy

Append `deploy/Caddyfile.rcm.snippet` to
`/root/ceez_ai_beta_launch/ceez-ai-main/Caddyfile`, then reload gracefully
(zero downtime for the other sites).

**The bind mount on this host is stale.** `/etc/caddy/Caddyfile` inside
`workforce-caddy` is a single-file bind mount, and the host file was replaced
while the container was running — Docker binds by inode, so the container still
holds the old, now-unlinked inode and cannot see edits to the host file.
Verify before trusting a reload:

```bash
stat -c %i /root/ceez_ai_beta_launch/ceez-ai-main/Caddyfile   # host
docker exec workforce-caddy stat -c %i /etc/caddy/Caddyfile   # container
```

Different numbers mean the mount is stale. Until `workforce-caddy` is recreated,
copy the config in and reload from that path:

```bash
docker cp /root/ceez_ai_beta_launch/ceez-ai-main/Caddyfile workforce-caddy:/tmp/Caddyfile
docker exec workforce-caddy caddy validate --config /tmp/Caddyfile
docker exec workforce-caddy caddy reload   --config /tmp/Caddyfile
```

Recreating the container fixes the mount permanently and makes
`--config /etc/caddy/Caddyfile` correct again — but it drops **all** sites on
80/443 for a few seconds, so it is a scheduled action, not a casual one.

---

## 8. Verify

```bash
# Caddy can reach each upstream over the edge network
docker exec workforce-caddy wget -qO- http://rcm-api:8000/health && echo " <- api ok"

# Public endpoints (cert issuance may take a few seconds on first hit)
curl -sI https://rcm-api.ceez.ai/health   | head -3
curl -sI https://rcm.ceez.ai              | head -3
curl -sI https://rcm-admin.ceez.ai        | head -3
curl -sI https://rcm-counter.ceez.ai      | head -3

# Same-origin API split works on a SPA subdomain
curl -sI https://rcm-admin.ceez.ai/api/v1/health | head -3

# Data landed
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod \
  exec -T postgres psql -U rcm -d rcm -c "select count(*) from reservations;"
```

---

## 9. File storage (MinIO) — dedicated container, code change already applied

RCM runs its **own** `rcm-minio` container (own volume `rcm_miniodata`, own root
credentials from `deploy/.env.prod`). The shared `workforce-minio` is never
touched — no CORS rules, no buckets, no credential reuse on it.

The S3 code change this used to require is **done**: `apps/api/app/core/s3.py`
provides `get_s3_client()` (server-side, internal endpoint) and
`get_presign_client()` (browser-facing, signs against `S3_PUBLIC_ENDPOINT`), and
the three former inline `boto3.client("s3", ...)` call sites now use them:

- `apps/api/app/domains/checkout/router.py` — signature upload URL
- `apps/api/app/domains/damage/router.py` — inspection photo upload URL
- `apps/api/app/worker/tasks/reporting_tasks.py` — report CSV upload

Path-style addressing and SigV4 are applied automatically whenever
`S3_ENDPOINT_URL` is set; with it unset the code falls back to plain AWS S3, so
local dev and tests are unaffected.

Two MinIO-specific details handled in code/config:

- **Presigned URLs must be signed against the host the browser hits.** Server-side
  calls use `http://rcm-minio:9000`; presigned URLs use
  `https://rcm-files.ceez.ai`. That is why there are two client factories.
- **MinIO rejects `ServerSideEncryption: AES256` without a KMS.** `supports_sse()`
  omits the parameter when a custom endpoint is configured, so the daily revenue
  report upload no longer fails.

Bucket creation and CORS are handled by `deploy/init-data.sh` step 4/4.

---

## 10. Day-2 operations

```bash
DC="docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env.prod"

$DC logs -f api                 # tail a service
$DC ps                          # status
$DC up -d --build api           # rebuild + redeploy one service after a code change
$DC run --rm -e DATABASE_URL="$DIRECT_DATABASE_URL" api alembic upgrade head   # new migrations
$DC down                        # stop (keeps the rcm_pgdata volume)
```

After pulling new frontend code, rebuild the affected image (`$DC up -d --build
web-admin`) — the Vite/Next bundles are baked at image-build time.

---

## 11. Gotchas worth remembering

- **Never add `ports:` to RCM services.** Exposure goes only through Caddy; that's
  what keeps ufw/iptables unchanged and nothing new on the internet.
- **Migrations bypass pgbouncer.** Always use `DIRECT_DATABASE_URL` for Alembic.
- **`NEXT_PUBLIC_*` and `VITE_*` are build-time.** Changing them means rebuilding
  the frontend image, not just restarting it.
- **Booking image display:** if you serve photos from `rcm-files.ceez.ai`, add it
  to `images.remotePatterns` in `apps/web-booking/next.config.mjs` or `next/image`
  will block them.
- **Cookies are per-subdomain.** admin/counter/booking each log in independently.
  If you ever need shared sign-in across them, the API must set a cookie scoped to
  `.rcm.ceez.ai` (parent domain) — not currently the case.
- **The custom Postgres requires `cron.database_name` to match the DB name.** The
  compose passes `-c cron.database_name=${POSTGRES_DB}`; keep them in sync.
```
