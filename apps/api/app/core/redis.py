from __future__ import annotations

from functools import lru_cache

from redis.asyncio import Redis, ConnectionPool

from app.core.config import settings

# ── Key namespace constants ──────────────────────────────────────────────────
# All Redis key patterns — no magic strings in business logic.

# Availability cache cluster (REDIS_AVAIL_URL)
AVAIL_KEY = "avail:{loc}:{cls}:{bucket}"           # TTL=60s
RATE_QUOTE_KEY = "rate_quote:{hash}"               # TTL=30s
TAX_CACHE_KEY = "tax:{input_hash}"                 # TTL=3600s

# Session cluster (REDIS_SESSION_URL)
SESSION_KEY = "session:{jti}"                      # TTL=28800s
REVOKED_TOKENS_SET = "revoked_tokens"              # SET of revoked JTIs
REFRESH_TOKEN_KEY = "refresh:{jti}"               # TTL=30d
WS_TOKEN_KEY = "ws_token:{token}"                 # TTL=60s
OTP_KEY = "otp:{customer_id}"                     # TTL=600s
PREAUTH_LOCK_KEY = "preauth_lock:{reservation_id}" # TTL=120s
LOGIN_FAIL_KEY = "login_fail:{email}"             # TTL=lockout window
# Cache of staff_users.token_epoch / customers.token_epoch. Postgres is the
# source of truth; this only saves a read per request. A miss re-reads the row,
# so losing this cluster costs latency, not correctness.
USER_EPOCH_KEY = "user_epoch:{user_id}"           # TTL=300s
# Short-lived token issued after a password check when the account has MFA on.
# Carries no privileges — it can only be exchanged for a real session.
MFA_PENDING_KEY = "mfa_pending:{challenge_id}"    # TTL=300s
MFA_ATTEMPT_KEY = "mfa_attempt:{challenge_id}"    # TTL=300s
TELEMATICS_DEDUP_KEY = "telematics:dedup:{device_id}:{timestamp}"  # TTL=300s
RATE_LIMIT_PARTNER_KEY = "ratelimit:partner:{key_id}:{window}"     # TTL=60s
DEDUP_KEY = "dedup:{hash}"                        # TTL=300s

# Pub/sub channels (availability cluster)
FLEET_CHANNEL = "fleet:{tenant_id}:{location_id}"

# Streams (session cluster)
NOTIFICATION_STREAM = "notifications:{tenant_id}"

# Agent sessions (session cluster, volatile-lru — sessions have TTL so they evict correctly)
AGENT_SESSION_KEY = "agent_session:{session_id}"  # TTL = settings.agent_session_ttl_seconds
AGENT_CIRCUIT_KEY = "agent_circuit:{tenant_id}"   # circuit breaker state, TTL 60s


# ── Connection pool factory ──────────────────────────────────────────────────

@lru_cache(maxsize=None)
def _make_pool(url: str, max_connections: int, decode_responses: bool) -> ConnectionPool:
    return ConnectionPool.from_url(
        url,
        max_connections=max_connections,
        socket_timeout=2.0,
        socket_connect_timeout=2.0,
        health_check_interval=30,
        retry_on_timeout=True,
        decode_responses=decode_responses,
    )


def get_avail_redis() -> Redis:
    """Availability cache cluster — allkeys-lru, decode_responses=True."""
    pool = _make_pool(
        settings.redis_avail_url.get_secret_value(),
        max_connections=50,
        decode_responses=True,
    )
    return Redis(connection_pool=pool)


def get_broker_redis() -> Redis:
    """Celery broker cluster — noeviction, raw bytes (no decode)."""
    pool = _make_pool(
        settings.redis_broker_url.get_secret_value(),
        max_connections=10,
        decode_responses=False,
    )
    return Redis(connection_pool=pool)


def get_session_redis() -> Redis:
    """Sessions / locks / OTP cluster — volatile-lru, decode_responses=True."""
    pool = _make_pool(
        settings.redis_session_url.get_secret_value(),
        max_connections=50,
        decode_responses=True,
    )
    return Redis(connection_pool=pool)


async def check_redis_health(redis: Redis) -> bool:
    """Ping the given Redis client. Returns True on success, False on error."""
    try:
        await redis.ping()
        return True
    except Exception:
        return False


# Legacy aliases used by ARCH_PLATFORM.md health check snippet
get_redis_avail = get_avail_redis
get_redis_broker = get_broker_redis
get_redis_sessions = get_session_redis


# ── Lifecycle helpers ────────────────────────────────────────────────────────

async def init_redis_pools() -> None:
    """Eagerly validate connections to all three clusters at startup."""
    for redis in (get_avail_redis(), get_broker_redis(), get_session_redis()):
        await redis.ping()


async def close_redis_pools() -> None:
    """Disconnect all pool connections gracefully."""
    for redis in (get_avail_redis(), get_broker_redis(), get_session_redis()):
        await redis.aclose()
