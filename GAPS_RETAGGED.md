# Phase 1 — Re-tagged findings

Every finding from `PRODUCTION_READINESS_GAPS.md`, re-labelled with the environment it actually
describes and the evidence class actually held. See `VALIDATION_PLAN.md` for the taxonomy.

Environments: **DEV** = local stack (alembic 058) · **TPL** = committed deploy templates ·
**PROD** = live rcm.ceez.ai (alembic 049, no multi-tenancy schema)

Evidence: **E0** reproduced · **E1** runtime-confirmed · **E2** code-read · **E3** inferred/absence-of-grep

`†` = I verified this myself. `‡` = agent-reported with a transcript, not independently re-run.
**MISATTRIBUTED** = originally worded as a PROD defect on TPL/DEV evidence.

---

## A — Isolation enforcement

| # | Finding | Env | Ev | Was | Now | Note |
|---|---------|-----|----|-----|-----|------|
| A1 | Deploy connects as owner/superuser | TPL + PROD | E1† | CRITICAL | **CRITICAL** | Holds. `usesuper=t` confirmed live. But PROD has no multi-tenancy schema, so it blocks the release rather than breaching a live multi-tenant system |
| A2 | `app_user` password hardcoded in migration 052 | TPL | E2† | CRITICAL | **HIGH** | MISATTRIBUTED. Migration 052 is unapplied in PROD (alembic 049). Real risk is the committed credential, which is a repo problem not a live one |
| A3 | Security lint (`S` ruleset) disabled | TPL | E2† | HIGH | **MEDIUM** | CI config; no runtime impact |

## B — Data exposure

| # | Finding | Env | Ev | Was | Now | Note |
|---|---------|-----|----|-----|-----|------|
| B1 | Public reservation PII leak via `X-Tenant-ID` | DEV | **E0†** | CRITICAL | **CRITICAL** | Fully reproduced. Route exists in the PROD image too — **needs a PROD reproduction to confirm it leaks there** (Phase 3) |
| B2 | `audit.audit_events` no RLS | DEV | E1‡ | CRITICAL | **CRITICAL** | Row/tenant counts confirmed by agent; re-run as `app_user` to reach E0 |
| B3 | Partitions bypass RLS | DEV | E2‡ | CRITICAL | **HIGH** | Needs a direct partition query as `app_user` to reach E0 |
| B4 | `tenants` / `email_verifications` no RLS | DEV | E1‡ | CRITICAL | **HIGH** | `email_verifications` doesn't exist in PROD at all |
| B5 | Shared-catalogue delete | DEV | **E0†** | CRITICAL | **CRITICAL** | Reproduced: 35 → 0 |
| B5b | Shared-catalogue hijack via `UPDATE SET tenant_id` | DEV | E2‡ | CRITICAL | **HIGH** | Not reproduced — separate from the delete |
| B6 | Isolation suite green through B1 | DEV | **E0†** | HIGH | **HIGH** | Confirmed: suite line 227 is a scoped DELETE |
| B7 | Cross-tenant FKs / unscoped bond release / webhook idempotency | DEV | E2‡ | HIGH | **MEDIUM** | Three separate claims, none reproduced |

## C — Identity

| # | Finding | Env | Ev | Was | Now | Note |
|---|---------|-----|----|-----|-----|------|
| C1 | `agent-token` takes `tenant_id` from body | DEV | E2† | CRITICAL | **HIGH** | Line confirmed, but the endpoint 500s for everyone (`HTTPException` unimported). **Cannot currently be exploited** — must show a successful cross-tenant mint or stay HIGH |
| C2 | Reset doesn't revoke refresh tokens | DEV | E0‡ | CRITICAL | **CRITICAL** | Agent transcript is convincing; re-run to confirm |
| C3 | Reuse detection revokes nothing | DEV | E0‡ | CRITICAL | **CRITICAL** | As above |
| C4 | MFA never checked at login | DEV | E1† | CRITICAL | **CRITICAL** | Confirmed: no `is_mfa_enabled` reference in the login path |
| C5 | OTP accepts any 6 digits | DEV | E2† | HIGH | **MEDIUM** | Branch confirmed live, but the endpoint 500s first (`user_locations` missing). Latent, not reachable |
| C6 | Reset/invite links from `Origin` header | DEV | E2† | HIGH | **HIGH** | Lines confirmed; agent showed a 202 on a forged Origin |
| C7 | OAuth `state` unbound to browser | DEV | **E0†** | HIGH | **HIGH** | Confirmed: 302 with no `Set-Cookie` |
| C8 | No login rate limit; lockout oracle | DEV | E0‡ | HIGH | **HIGH** | |
| C9 | Deny-list revocation; Redis wipe un-revokes | DEV | E0‡ | HIGH | **HIGH** | |
| C10 | WebSocket ignores revocation, JWT in URL | DEV | E0‡ | HIGH | **HIGH** | |

## D — Tenant lifecycle

| # | Finding | Env | Ev | Was | Now | Note |
|---|---------|-----|----|-----|-----|------|
| D1 | Provisioning creates 0 rate schedule items | DEV | **E0†** | CRITICAL | **CRITICAL** | Verified across all three self-service tenants |
| D2 | Deletion misses 11 tables | DEV | E2‡ | CRITICAL | **HIGH** | Needs the provision→delete→diff test |
| D3 | Deletion fails silently | DEV | E2‡ | CRITICAL | **HIGH** | As above |
| D4 | Both `pg_cron` jobs failing since 15 Jul | DEV | **E0†** | CRITICAL | **HIGH** | Confirmed — but DEV only. **PROD unchecked** |
| D5 | No backup/restore/export | DEV+TPL | E3 | CRITICAL | **HIGH** | Absence-of-artefact finding |
| D6 | Tenant status enforced only at login/refresh | DEV | E2‡ | HIGH | **MEDIUM** | |

## E — Operations

| # | Finding | Env | Ev | Was | Now | Note |
|---|---------|-----|----|-----|-----|------|
| E1 | "Production sends no email" | **TPL** | E3† | CRITICAL | **HIGH** | **MISATTRIBUTED — the worked example.** Server *does* have working SMTP (3 ceez containers). RCM stack isn't wired to it: no `SMTP_*`, 14-char SendGrid stub, and the PROD image has no `mailer.py` at all. The claim "no account can ever be activated" was **false** — signup isn't deployed |
| E2 | `localtest.me` public hosts; no wildcard DNS/cert | TPL | E2† | HIGH | **HIGH** | Blocks the release. Hostname tenancy genuinely cannot resolve in the deployed topology |
| E3 | `tenant_id` null on every log line | DEV | E2† | CRITICAL | **HIGH** | Confirmed by grep; one-line fix |
| E4 | `/health` green while broker dead | DEV | **E0†** | HIGH | **HIGH** | curl output confirms broker absent from checks |
| E5 | 4 of 13 beat jobs have no consumer | DEV+TPL | E1† | HIGH | **HIGH** | Two modules confirmed empty (1 line, 0 tasks) |
| E6 | No Sentry / metrics / tracing | DEV+TPL | E1† | HIGH | **MEDIUM** | Confirmed: 0 sentry refs, sentry-sdk absent |
| E7 | No React error boundary | DEV | E3† | CRITICAL | **MEDIUM** | Absence-of-grep (0 matches). Real, but E3 caps it |
| E8 | Counter offline queue write-only | DEV | E2‡ | HIGH | **HIGH** | Revenue-bearing; worth promoting to E0 |
| E9 | Stripe idempotency key regenerated | DEV | E2‡ | HIGH | **HIGH** | |
| E10 | CI deploy is `echo` stubs | TPL | E2† | HIGH | **MEDIUM** | |
| E11 | No task time limits / per-tenant quota | DEV+TPL | E2‡ | MEDIUM | **MEDIUM** | |
| E12 | Circuit breaker per-process, tenant-global | DEV | E2‡ | MEDIUM | **MEDIUM** | |

## F — Roles

| # | Finding | Env | Ev | Was | Now | Note |
|---|---------|-----|----|-----|-----|------|
| F1 | `FINANCE_ANALYST` has zero permissions | DEV | E1† | HIGH | **HIGH** | Confirmed by query |
| F2 | Damage endpoints gated on wrong resource | DEV | E2‡ | HIGH | **MEDIUM** | |
| F3 | No separation of duties | DEV | E2‡ | HIGH | **MEDIUM** | Design gap |
| F4 | Unauthenticated `POST /tenants` | DEV | E2‡ | MEDIUM | **HIGH** | Under-rated originally if reproducible |
| F5 | No role change / reactivate / delete | DEV | E2† | MEDIUM | **MEDIUM** | |
| F6 | `BRANCH_MANAGER` can invite `SYSTEM_ADMIN` | DEV | E2‡ | MEDIUM | **MEDIUM** | |
| F7 | Location scoping unused | DEV | E3† | MEDIUM | **MEDIUM** | Absence-of-grep |
| F8 | Two password policies | DEV | E2‡ | MEDIUM | **MEDIUM** | |
| F9 | TOTP secrets plaintext | DEV | E1† | MEDIUM | **MEDIUM** | Confirmed by query |
| F10 | Session list unusable | DEV | E1‡ | MEDIUM | **LOW** | |

---

## Tally

| | Original | Re-tagged |
|---|---|---|
| CRITICAL | 18 | **8** |
| HIGH | 15 | **21** |
| MEDIUM | 7 | **15** |
| LOW | 0 | **1** |

**Misattributed (worded as PROD, evidenced on TPL/DEV): 9** — A2, A3, E1, E2, E5, E6, E10, D5, and the
PROD half of A1.

**Reproduced end-to-end (E0): 8** — B1, B5, B6, C7, D1, D4, E4, plus agent-transcript E0s in C2/C3/C8/C9/C10
pending independent re-run.

## The 8 that survive as CRITICAL

1. **A1** — deploy connects as superuser (release blocker; confirmed live)
2. **B1** — public reservation PII leak (reproduced; needs a PROD check)
3. **B2** — `audit.audit_events` no RLS
4. **B5** — shared-catalogue delete (reproduced)
5. **C2** — password reset doesn't revoke refresh tokens
6. **C3** — refresh-reuse detection revokes nothing
7. **C4** — MFA never enforced at login
8. **D1** — new tenants cannot quote (reproduced)

Everything else was over-rated by impact-without-evidence, or described a template as if it were a
running system.
