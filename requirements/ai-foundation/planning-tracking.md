# ai-foundation — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — AI foundation

### Architecture
| Component | Location | Notes |
|---|---|---|
| LLM provider | `api/src/ai/providers/` (interface, fake, anthropic adapter, error map) | `complete({system, user, maxOutputTokens, signal})`. Anthropic through `ChatAnthropic` (`@langchain/anthropic`) with `maxRetries: 0`, no sampling parameters, no forced tool choice; output parsed with strict Zod. |
| Embeddings | `api/src/ai/embeddings/` (interface, fake, local via `@huggingface/transformers`) | Local model loaded lazily; vector length must equal `EMBEDDING_DIM` (384). `EMBEDDINGS_PROVIDER` defaults to `fake` in `.env.example`. |
| Vector helper | `api/src/ai/vector.ts` | `toPgVector` checks length and finiteness; used only as a bound value in raw SQL. |
| Task registry | `api/src/ai/tasks/` | Only `PING` registered in this phase. |
| Job service | `api/src/services/ai-jobs.service.ts` | enqueue, toggle, state, cancel pending for a session. |
| Runner | `api/src/ai/runner.ts` | Polls every second, nudged on enqueue; bounded concurrency; reserve-then-settle budget under the session lock; stale recovery at start and every 60 s. |
| Operator switch | `api/src/routes/ai-operator.routes.ts` | Runtime global kill switch (see Decision 2). |
| Presenter channel | `api/src/realtime/ai.ts` | Presenter room only. |

### Key decisions
1. Claude through `@langchain/anthropic` (one integration with the later LangChain phases).
2. **Kill switch: runtime operator toggle plus the env default (developer choice).** The operator route
   `PATCH /api/ops/ai { enabled }` requires an operator key sent in the `X-Operator-Key` header. The key is an env value
   `OPERATOR_KEY` (at least 32 characters, required; compared with `timingSafeEqual`; never logged). **This is a new auth
   surface — approval needed (see Approvals).** Turning the switch off cancels every pending AI job and refuses new ones.
3. Vectors read and written through parameterised `sequelize.query`; no pgvector npm package.
4. Budget = reserve then settle (developer choice): a job reserves its estimate under the session row lock; usage shown
   to the presenter includes reservations.
5. Lock order: session, then job, always.
6. Ended sessions refuse AI-on; `allowAfterEnd` deferred to the report phase.

### Database (three generated migrations; down only on the test DB)
| # | Up | Down |
|---|---|---|
| M1 `enable-pgvector` | `CREATE EXTENSION IF NOT EXISTS vector` | `DROP EXTENSION IF EXISTS vector` (no CASCADE) |
| M2 `add-ai-columns-to-sessions` | `ai_enabled` default false, `ai_token_budget` default 200000, `ai_tokens_used` default 0; CHECKs budget > 0 and used ≥ 0 | Drop CHECKs, then columns — **destructive** (AI flag and usage lost) |
| M3 `create-ai-jobs` | `ai_jobs` table: id, session_id FK CASCADE, type (CHECK list), status enum (PENDING, RUNNING, SUCCEEDED, FAILED, SKIPPED), attempts, max_attempts (1–10), run_after, input jsonb, output jsonb, error_code, model, prompt_version, token counts, reserved_tokens, dedupe_key, timestamps; CHECKs on attempts, finished_at vs status, FAILED requires error_code; partial unique on (session_id, dedupe_key) for active jobs; claim index; stale index | Drop table, then enum — **destructive** (job history lost) |

### Contracts
**HTTP** (presenter cookie unless noted; mutations pass the origin check):
| Route | Body | 2xx | Errors |
|---|---|---|---|
| GET /api/sessions/:id/ai | – | 200 `{enabled, globalEnabled, provider, usage:{tokensUsed, tokenBudget}, recentFailures}` (last 5, no input or output) | 401, 404 |
| PATCH /api/sessions/:id/ai | strict `{enabled}` | 200 `{enabled, cancelledJobs}` | 400, 409 SESSION_ENDED, 503 AI_DISABLED |
| POST /api/sessions/:id/ai/jobs/diagnostic | none | 202 `{jobId, status, created}` (dedupe key `diagnostic`) | 409 AI_OFF_FOR_SESSION / SESSION_ENDED / AI_BUDGET_EXHAUSTED, 503 AI_DISABLED, 429 (10/min) |
| GET /api/sessions/:id/ai/jobs/:jobId | – | 200 job summary (never input or output) | 401, 404 (also for another session's job) |
| PATCH /api/ops/ai | strict `{enabled}` | 200 `{enabled}` | 401 (missing or wrong operator key), 400 |

**Socket** (presenter room only, after commit): `ai:status {sessionId, enabled, globalEnabled}`,
`ai:usage {sessionId, tokensUsed, tokenBudget}`, `ai:job-failed {sessionId, jobId, type, taskName, errorCode, message, failedAt}`.

**Env:** `AI_ENABLED` (default true), `AI_PROVIDER` (fake | anthropic, default fake), `ANTHROPIC_API_KEY` (required only
when anthropic), `AI_MODEL` (default claude-opus-5-5), `EMBEDDINGS_PROVIDER` (local | fake, default fake in `.env.example`),
`EMBEDDINGS_MODEL`, `EMBEDDINGS_DIM` (384, must equal shared `EMBEDDING_DIM`), `AI_MAX_CONCURRENCY` (default 2),
`AI_MAX_ATTEMPTS` (default 3), `AI_SESSION_TOKEN_BUDGET` (default 200000), **`OPERATOR_KEY` (new)**. A failing config
prints key names only.

### Concurrency
- **Claim:** pick a candidate without a lock; then in one short transaction lock the session `FOR UPDATE`, and
  `UPDATE ai_jobs SET status='RUNNING', attempts=attempts+1 WHERE id AND status='PENDING' AND run_after<=now()`. Zero rows
  means another runner won. The reserve check and the increment happen in this same locked step.
- **Enqueue:** session `FOR SHARE`; checks global switch, ai_enabled, ACTIVE, budget; insert with
  `ON CONFLICT … DO NOTHING` (dedupe); nudge after commit.
- **Toggle off / operator off:** `FOR UPDATE`; cancel pending jobs in the same transaction.
- **Completion:** `WHERE id AND status='RUNNING' AND attempts=:claimed`, so a stale run cannot overwrite a newer one; if AI is
  now off, the output is discarded and the job is SKIPPED (tokens spent still charged).
- **Session end:** existing `endSession` gains a cancel of pending jobs (HIGH risk: shared hot path).
- **Restart recovery:** per stale RUNNING row, under the session lock, conditional update; refund the reservation; PENDING if
  attempts remain, else FAILED `RUNNER_INTERRUPTED`.

### Security
- AI off, global off, or unregistered type → no provider call (tests assert the fake's call count is 0).
- Events and data go only to the presenter room; DTOs never include input, output or prompts.
- `ANTHROPIC_API_KEY` and `OPERATOR_KEY` are read once, never logged (logger redacts), never returned.
- Provider errors map to safe codes (rate limit, unavailable, timeout, invalid output → retry; auth, rejected, internal → no retry).
- LangSmith tracing environment variables stay unset (documented in `.env.example`).
- PING sends a fixed input; no audience text leaves the server in this phase.

### Testing
- Unit: env rules; fake provider determinism and calls; error map; vector helper; fake embeddings length; PING schemas.
- Integration (test DB): claim race (two runners, one run); budget race (only budget-allowed jobs run); restart recovery (a stale
  row runs once; a fresh RUNNING row is untouched); kill switch and AI-off (503/409, calls 0); retry and back-off; session end
  cancels; dedupe; route matrix; pgvector probe; migration down then up.
- Realtime: presenter gets the three events; a participant socket gets none; shutdown requeues in-flight jobs.
- Web: hook and panel states (on, off, global off, usage, failure).
- Opt-in, never in default runs: `anthropic-smoke` and `local-embeddings` tests gated by `AI_LIVE_TEST=1`.

## Tasks (v1 with the operator switch added)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Shared AI schemas, codes, messages, task types, EMBEDDING_DIM, 3 events | MEDIUM | executor-medium | done | |
| 2 | Env keys incl. OPERATOR_KEY and conditional provider keys | LOW | executor-low | done | |
| 3 | Install approved packages (exact pins), npm audit review | LOW | inline | done | approved |
| 4 | Migrations M1–M3 (up, down, up on test DB) | HIGH | executor-high | done | destructive down on test DB only |
| 5 | AiJob model, Session attributes, associations | MEDIUM | executor-medium | done | |
| 6 | Provider interface, fake, error map, Anthropic adapter | MEDIUM | executor-medium | done | |
| 7 | Embeddings interface, fake, local, vector helper, pgvector probe | MEDIUM | executor-medium | done | |
| 8 | Task registry and PING | LOW | executor-low | done | |
| 9 | ai-jobs.service (enqueue, toggle, state, cancel, createSession budget) | HIGH | executor-high | done | |
| 10 | Runner (claim, reserve, execute, settle, retry, recovery) | HIGH | executor-high | done | |
| 11 | Realtime presenter-room emitters | HIGH | executor-high | done | |
| 12 | Routes: session AI endpoints and operator switch | MEDIUM | executor-medium | done | |
| 13 | Wire server, app, shutdown, helpers; full suite green | HIGH | executor-high | done | |
| 14 | Web AI client and hook | MEDIUM | executor-medium | done | |
| 15 | AiPanel in presenter dashboard | MEDIUM | executor-medium | done | |
| 16 | Opt-in live tests and script (excluded from default runs) | LOW | executor-low | done | |
| 17 | Docs and tracking | LOW | executor-low | done | |

## Execution groups
G1 (1, 2, 3) → G2 (4, 5) → G3 (6, 7, 8) → G4 (9, 10, 11) → G5 (12, 13) → G6 (14, 15) → G7 (16, 17).

## Approval
- Plan v1 approved by the developer on 2026-10-24 (including the OPERATOR_KEY design). Execution started.

## Approvals needed
- **Packages (approved 2026-10-24):** `@langchain/core`, `@langchain/anthropic`, `@huggingface/transformers` (heavy:
  native binaries about 100–200 MB; one-time install).
- **Operator key (approval needed):** new env `OPERATOR_KEY` and the `PATCH /api/ops/ai` route with header auth.
- **Developer provides** `ANTHROPIC_API_KEY` locally before the opt-in live test (each live test costs money).
- **One-time model download** (`Xenova/all-MiniLM-L6-v2`, about 23 MB) into `api/.cache/models` (git-ignored) when
  `EMBEDDINGS_PROVIDER=local` is first used.
- **Destructive down migrations (M2, M3):** test database only until you approve.
- **`endSession` change:** a shared, high-risk path; covered by tests.

## Decisions (answered 2026-10-24)
- Packages approved. Kill switch: runtime operator toggle plus env default. Budget: reserve then settle.
  `.env.example` defaults `EMBEDDINGS_PROVIDER` to `fake`.

## Issues & updates
- 2026-10-25 · MEDIUM · Fake provider echoes its prompt, so the diagnostic (PING) job always ends FAILED with INVALID_OUTPUT in fake mode. Open: developer to choose a fixed-reply fake or a fake-only PING check. Not changed.
- 2026-10-25 · LOW · Real Anthropic call (success criterion 9) and local embeddings model load (criterion 10) not run; opt-in via `npm run test:live` with `ANTHROPIC_API_KEY`. Not run, no key.
- 2026-10-25 · LOW · Operator switch and global AI state are in-process memory; correct for one server instance only. A shared store is needed before scaling out.
- 2026-10-25 · LOW · Task 9 ran `prettier --write` over all of `api/`; unrelated files may have been reformatted. Not yet checked against the pre-existing uncommitted work.

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-24 | plan_created | Plan v1 drafted by planner; operator kill switch added by developer decision; packages approved; awaiting plan approval (OPERATOR_KEY design) | planning-tracking.md |
| 2026-10-24 | approved | Plan v1 approved with OPERATOR_KEY optional (503 when absent); execution started | planning-tracking.md |
| 2026-10-24 | done | Tasks 1–8 (schemas, env, packages, migrations M1–M3, models, providers, embeddings, PING registry); migrations verified up/down/up on test DB only | api/, shared/ |
| 2026-10-25 | done | Task 9 job service: enqueue dedupe, toggles, cancel, endSession cancel; 11 integration tests | ai-jobs.service.ts, sessions.service.ts |
| 2026-10-25 | done | Task 10 runner: claim with session lock, reserve/settle, retry, recovery, stop; 10 integration tests | ai/runner.ts |
| 2026-10-25 | done | Task 11 presenter-room AI events; 6 realtime tests | realtime/ai.ts |
| 2026-10-25 | done | Task 12 routes and operator switch; reservation-aware usage; 16 route tests | ai.routes.ts, ai-operator.routes.ts |
| 2026-10-25 | done | Task 13 startup/shutdown wiring, logger redaction; 4 startup tests; forward migration applied to dev DB; API start checked (health 200, AI route 404 for unknown session) | server.ts, startup.ts, shutdown.ts |
| 2026-10-25 | done | Tasks 14–15 web AI client, hook, AiPanel; 141 web tests pass | web/src/ |
| 2026-10-25 | done | Tasks 16–17 opt-in live tests (`npm run test:live`), docs, Hindi stage-07. Verified: typecheck, unit 79, integration 365 passed / 1 skipped (exit 0). Live tests not run. | api/tests/live/, docs/ |
