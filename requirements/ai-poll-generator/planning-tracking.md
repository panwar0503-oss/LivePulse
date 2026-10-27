# ai-poll-generator — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — AI poll suggestions

### Architecture
| Part | Design |
|---|---|
| Task | `api/src/ai/tasks/suggest-polls.task.ts`, registered as `SUGGEST_POLLS` (already in `AI_TASK_TYPES`). Input `{ kind: 'suggest-polls' }`, strict. Loads up to 8 READY passages, numbers them `[1..N]` inside `<passage index="i">` delimiters, calls the provider (maxOutputTokens 800), parses JSON, validates with a strict schema (0–3 polls; question ≤ 200; 2–4 options ≤ 80; passageIndex integer). A bad item or out-of-range index is dropped, not fatal. Output `{ polls: [{ question, options, passageId }] }` (ids only). Unparseable JSON → `INVALID_OUTPUT`, not retried. Zero valid items → SUCCEEDED with an empty list. `reserveTokens` 3000, `allowAfterEnd` false, `promptVersion` `suggest-polls-v1`. |
| Storage | Output stays on `ai_jobs.output`. No migration. The runner already discards output on SKIPPED (AI off, session end). GET routes look up `passageId` against READY passages on read, so a deleted document's suggestion is hidden. |
| Request | `api/src/services/poll-suggestions.service.ts` → `enqueueAiJob` plus an optional `beforeInsert(tx)` hook (after switch and budget checks, under session FOR SHARE). The hook throws `NO_RELEVANT_PASSAGES` when no READY passage exists, and returns the latest SUCCEEDED job if it finished within 30 s. |
| Realtime | `poll-suggestions:ready` to the presenter room from `onRunnerEvent` when a SUGGEST_POLLS job reaches a terminal status. |
| Web | Poll tab: `PollSuggestions` panel with "Suggest polls". "Use this" fills `CreatePollForm` through an optional `initialValues` prop plus a remount key. Creating still uses the existing `onCreate`. |

### Key decisions
1. Retrieval without a topic: even sampling of READY passages (`selectPollSourcePassages`), because `searchKnowledge` needs a query. (Open question 1.)
2. The model returns indices; the server maps them to passage ids. The model writes no citation text.
3. Output is only parsed, never executed. Passages are data; the system prompt says to ignore instructions inside them.
4. Session end needs no change: `cancelPendingAiJobs` and runner settle already skip the job.
5. The fake provider returns a fixed valid reply when the system prompt carries the marker `[task:suggest-polls]`. Malformed-output tests use a scripted provider.

### Contracts
- `POST /api/sessions/:id/poll-suggestions`: body `{}` strict → 202 `{ jobId, status, created }`. Presenter cookie and origin check. Rate limit 6/min per session. Errors: 400, 401/403, 404, 409 `AI_OFF_FOR_SESSION` | `AI_BUDGET_EXHAUSTED` | `SESSION_ENDED` | `NO_RELEVANT_PASSAGES`, 503 `AI_DISABLED`, 429.
- `GET /api/sessions/:id/poll-suggestions/:jobId` → `{ jobId, status, errorCode, message, outcome: PENDING|READY|NONE|FAILED, suggestions }`. Presenter only; scoped by session (404 otherwise); type must be SUGGEST_POLLS.
- `GET /api/sessions/:id/poll-suggestions/latest` → same DTO or `null`; `null` once the session has ended.
- `Suggestion` = `{ index, question, options, source: { documentName, location, text } }`.
- Shared: `shared/src/schemas/poll-suggestions.ts` (`POLL_SUGGESTION_LIMITS`, accepted and result schemas). Event `poll-suggestions:ready { sessionId, jobId, status }`, presenter room only, no text.

### Database
None. No migration.

### Concurrency
- Double click while in flight: partial unique index on `(session_id, dedupe_key)` for PENDING/RUNNING.
- Double click just after completion: 30 s recent-SUCCEEDED check under the session lock.
- A suggestion becomes a poll only through the existing `createPoll` (session FOR SHARE, poll cap). Poll create is not changed.

### Security
- Presenter check via `authorizePresenter`, same as the AI routes.
- Output checked against schema and index range; no passage text in events, logs or job output.
- The task never logs prompts.

### Testing
- Unit: prompt builder (delimiters, index list), output parser and index mapper, injection text stays inside delimiters, drops bad items.
- Integration: three suggestions with sources; none relevant; AI off → provider calls 0; budget refused; double request → one job; session end → SKIPPED, no suggestions; creating from a suggestion gives a normal draft poll; PING and INGEST regression after the hook change.
- Realtime: presenter receives ready; participant does not.
- Web: static markup for each state; "Use this" fills the form; nothing created until Create.

### Tasks (v1)
| # | Task | Cx | Executor | Deps | Check |
|---|---|---|---|---|---|
| **G1** | | | | | `npm run typecheck -w shared && npm test -w shared` |
| 1 | Shared schemas, limits, event type, tests | LOW | executor-low | — | schema tests |
| **G2** | | | | | `npm test -w api -- suggest-polls` |
| 2 | `selectPollSourcePassages` + integration test | MEDIUM | executor-medium | 1 | READY only, session scoped |
| 3 | Prompt builder, output parser, index mapper, unit tests | HIGH | executor-high | 1 | drops bad items; injection stays in delimiters |
| 4 | Task run, registry entry, fake fixed reply, error mapping | HIGH | executor-high | 2, 3 | JSON error → INVALID_OUTPUT |
| **G3** | | | | | `npm run test:integration -w api -- poll-suggestions` |
| 5 | Optional `beforeInsert` hook in `enqueueAiJob` + regression | HIGH | executor-high | — | existing ai-jobs tests pass |
| 6 | Service: request (dedupe, NO_RELEVANT_PASSAGES), latest and by-job DTOs | HIGH | executor-high | 4, 5 | integration |
| 7 | Controller, routes, rate limit, wiring in app.ts | MEDIUM | executor-medium | 6 | Supertest 202/401/403/404/409/429/503 |
| 8 | Integration suite (see Testing) | MEDIUM | executor-medium | 7 | as listed |
| **G4** | | | | | `npm run test:integration -w api -- realtime` |
| 9 | Emit `poll-suggestions:ready` + socket test | MEDIUM | executor-medium | 4 | room isolation |
| **G5** | | | | | `npm test -w web && npm run typecheck -w web` |
| 10 | Web client, socket handling, refetch on reconnect | MEDIUM | executor-medium | 7, 9 | client tests |
| 11 | `CreatePollForm` `initialValues` + key remount | inline | inline | — | markup test |
| 12 | `PollSuggestions` states and "Use this" | MEDIUM | executor-medium | 10, 11 | static markup tests |
| 13 | Docs (04, 05) and tracking | LOW | executor-low | all | review |

### Approvals needed
- No new packages. No migration.
- Optional `beforeInsert` hook on the shared `enqueueAiJob` path. Existing callers unchanged.
- Fake provider fixed reply for the suggest-polls marker (test and dev infrastructure).
- New routes `POST` and `GET /api/sessions/:id/poll-suggestions[/latest|/:jobId]`, rate limit 6/min.
- Poll create and session end are not changed.

### Risks
| Level | Risk | Mitigation |
|---|---|---|
| HIGH | Change to the shared `enqueueAiJob` path | Optional parameter; existing tests plus regression |
| MEDIUM | Prompt injection in passages | Delimiters, schema-only parse, length caps, presenter review |
| MEDIUM | Sampled passages are off-topic | Source shown with each suggestion; open question 1 |
| LOW | `reserveTokens` estimate wrong | Tune; runner checks again at claim |

### Open questions (with the planner's recommendation)
1. Retrieval without a topic: even sampling (recommended) or a query built from document names.
2. Persistence: a used suggestion is hidden only on the client (recommended for v1). After a reload, all three return. Hiding on the server needs a table or a migration.
3. Duplicate window: 30 s, no "suggest again" override (recommended).
4. `NO_RELEVANT_PASSAGES`: a feature-local code, not the shared AI enum (recommended).

## Approval
- Plan v1 approved by the developer on 2026-10-25 with the recommended answers: even sampling of passages; used suggestions hidden in the browser only; 30 s duplicate window with no override; feature-local `NO_RELEVANT_PASSAGES`. Approved: optional `beforeInsert` hook on `enqueueAiJob`; fake provider fixed reply for the suggest-polls marker; the two new routes with 6/min rate limit. No new packages, no migration. Execution started.

## Progress
- G1 (task 1) done: shared 124/124; typecheck 0.
- G2 (tasks 2–4) done: passage sampler integration 4/4; parser unit 11/11; task run unit (128 total).
- G3 (tasks 5–8) done: enqueue hook regression 3/3; existing AI files 37/37; poll-suggestions service 9/9; routes 9/9; flow 5/5.
- G4 (task 9) done: realtime poll-suggestions-events 3/3.
- G5 (tasks 10–12) done: web typecheck 0, lint 0, tests 161/161.
- Task 13 (docs and Hindi stage-09) done.
- Full API run 2026-10-25: unit 128/128; integration 68 files, 444 passed, 1 skipped, exit 0.
- Requirement stays `in_progress` until the live checks run: a real model reply, the live browser, and the request-created realtime path (no test yet).

## Decisions
<!-- Filled after the developer answers the open questions and approves. -->

## Issues & updates
- 2026-10-25 · MEDIUM · The 6-per-minute suggestion limit runs before the presenter check, so anyone who knows a session id can use up its requests and block the presenter for a minute. No tokens are spent. Open: the developer decides whether to check the cookie first.
- 2026-10-25 · LOW · The `poll-suggestions:ready` event for a request that creates a job (PENDING) is wired but has no test. Covered only for finished jobs.
- 2026-10-25 · LOW · The fake provider's suggestion reply is a fixed fixture; a real model's output has not been checked against the parser's rules.

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-25 | plan_created | Plan v1 drafted by planner; four open questions with recommendations; awaiting approval | planning-tracking.md |
