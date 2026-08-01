# Validation Plan — re-grounding the production-readiness assessment

The first pass of `PRODUCTION_READINESS_GAPS.md` mixed three environments under one word,
"production". This plan re-validates every finding against the environment it actually claims to
describe, and states what evidence is required before a finding may keep its severity.

---

## 1. The three environments

| ID | Environment | What it is | How to inspect |
|----|-------------|------------|----------------|
| **DEV** | Local stack | `apps/api/.env`, Postgres on 5434, alembic **058**, 28 RLS tables, real Gmail SMTP | direct psql / curl on 127.0.0.1 |
| **TPL** | Committed deploy templates | `deploy/.env.prod.example`, `docker-compose.prod.yml`, CI workflows. Describes a **hypothetical fresh deploy** | read the repo |
| **PROD** | Live `rcm.ceez.ai` | `/root/rental-car-manager/deploy` on 63.250.55.137, alembic **049**, 13/40 RLS tables, **no multi-tenancy schema** | `ssh root@63.250.55.137`, read-only |

**The rule that was violated:** a finding derived from TPL may never be stated as a fact about PROD.
TPL findings predict what happens *when you deploy*; they are not live incidents.

**Critical context established on 2026-08-01:** PROD runs a build predating the entire multi-tenancy
effort. `staff_invitations`, `email_verifications`, and `plan_limits` do not exist there. Any finding
about signup, invitation, verification, plan limits, or the platform console **cannot** be a live
production defect — those features are not deployed.

---

## 2. Evidence classes

Every finding gets exactly one tag. Severity is capped by evidence class.

| Class | Meaning | Max severity | What it takes to earn it |
|-------|---------|--------------|--------------------------|
| **E0 — Reproduced** | Observed failing against a running system; the transcript shows input and output | CRITICAL | A command and its output, in the environment named |
| **E1 — Runtime-confirmed** | A runtime property read from a live system (config value, role attribute, row count) | HIGH | Query output, environment named |
| **E2 — Code-read** | Derived from reading source; no execution | MEDIUM | File and line, plus an argued path from an entry point |
| **E3 — Inferred** | Derived from a template, doc, or absence of a grep hit | LOW | Must state which environment it predicts, and must not name another |

A finding that cannot be raised to E0/E1 in the environment it claims does not keep a CRITICAL rating.

---

## 3. What went wrong, concretely

**E1 (email) — the worked example.**

| Claim as written | Evidence I actually had | What is true |
|---|---|---|
| "Production sends no email at all" | `deploy/.env.prod.example` has `SG.xxx` — **TPL, class E3** | The *server* has working SMTP: `cstg-api`, `ceezstg-api`, `ceez_notifications` all carry real `SMTP_HOST`/`SMTP_USER` |
| "No account can ever be activated in production" | never checked PROD | **False.** Signup is not deployed; `email_verifications` does not exist in PROD |
| — | — | RCM stack specifically: no `SMTP_*`, 14-char `SENDGRID_API_KEY` (real ≈69), and the deployed image has **no `mailer.py` and no smtplib/sendgrid code** |

Corrected finding: *"The RCM deployment is not wired to the mail transport that already works on this
host. Blocks the multi-tenancy release; not a live defect."* — class E1, severity **HIGH**, environment
**TPL+PROD-config**, and the fix is four env vars, not new infrastructure.

---

## 4. Re-validation procedure

### Phase 1 — Re-tag (no new evidence gathered)
Walk all 40 findings. For each, record: the environment it claims, the evidence actually held, and the
resulting class. Any finding whose stated environment ≠ evidenced environment is flagged **MISATTRIBUTED**
and its severity is suspended pending Phase 2 or 3.

Expected outcome from the sample already checked: the entire A-class (deploy role, `app_user` password)
and much of E-class (email, public hosts, workers, CI) are TPL findings currently worded as PROD.

### Phase 2 — Promote DEV findings to E0
For every isolation, auth, RBAC, and lifecycle finding, produce a reproduction against the local stack:
a command, its output, and the tenant/user involved. Findings that cannot be reproduced drop to E2 and
lose CRITICAL status.

Priority order (these carry the register):
- B1 public reservation PII leak — **already E0**
- B5 shared-catalogue delete/hijack — delete **already E0**; the `UPDATE ... SET tenant_id` hijack is still E2
- B2/B3/B4 RLS gaps — confirm by querying as `app_user`, not as owner
- C1 agent-token cross-tenant mint — currently E2 *and* known to 500; must show a successful cross-tenant mint or be downgraded
- C2/C3/C4 refresh survival, reuse detection, MFA bypass — agent reported E0; re-run independently
- D1 zero rate schedule items — **already E0**
- D2/D3 deletion completeness — provision a throwaway tenant, delete it, diff every tenant-bearing table

### Phase 3 — Establish PROD ground truth
Read-only. For each finding claiming PROD, check the live system:
- Does the code path exist in the deployed image?
- Does the table/column exist at alembic 049?
- Is the runtime config what the template says?

Findings whose code path is absent from PROD are re-labelled **"blocks the release"**, not **"live defect"**.

### Phase 4 — Fix the instruments
The register is only as good as the tests behind it.
- `isolation_suite.py:227` is vacuous (asserts a scoped DELETE). Rewrite to run genuinely unscoped SQL.
- The suite covers no anonymous/public routes, which is why it read 19/19 green while B1 was live. Add
  header-forgery cases for every unauthenticated endpoint.
- Add a test that fails if any route reachable without a session lacks a tenant predicate.
- Wire `tenant_sql_lint.py` into CI — it needs no database and could run today.

### Phase 5 — Reissue
Rewrite `PRODUCTION_READINESS_GAPS.md` with an environment column and an evidence class on every row.
Severity becomes a function of (impact × evidence), not of impact alone.

---

## 5. Exit criteria

The assessment is trustworthy when:

1. Every finding names exactly one environment, and the evidence held matches it.
2. No CRITICAL finding rests on class E2 or E3.
3. Every CRITICAL has a reproduction that a second person can run from the document alone.
4. Every finding about PROD has been checked against the deployed image, not a template.
5. The isolation suite fails on B1 and B5 before any fix is applied — proving the instrument detects
   what it missed the first time.

Criterion 5 is the important one. A suite that reads green through a live PII leak has negative value:
it converts an unknown risk into a false assurance.

---

## 6. Standing correction to how I report

- Name the environment in the sentence, every time.
- Never promote a template to a production claim.
- Distinguish "this is broken now" from "this will break when you deploy" — they carry different urgency
  and different owners.
- When a finding rests on an absent grep hit, say so; absence of a call site is weaker evidence than a
  failing request.
