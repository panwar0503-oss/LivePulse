# mcp-server — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — MCP server with approval-gated proposals

### Architecture
```
DB        ai_actions (new, 1 additive migration): session-scoped proposals; PostgreSQL is the source of truth.
API       /sessions/:id/ai/actions: propose (MCP), list, approve, reject (web).
          ai-actions.service: claim (compare-and-set PROPOSED→APPROVED) → presenter-commands.run* (same services
          and emits as the web UI) → settle EXECUTED|FAILED. endSession expires PROPOSED rows. Startup sweep marks
          stale APPROVED rows FAILED/INTERRUPTED.
Realtime  ai-action:updated {sessionId, actionId, type, status} → presenter room only, after each commit.
          Audience: existing poll:* and question:updated events, unchanged.
Web       AiPanel → AiProposals (list + Approve/Reject); use-ai-actions hook (HTTP snapshot, refetch on event and
          reconnect); polls refetch when a CREATE_POLL action is EXECUTED.
MCP       api/src/mcp/: stdio server, @modelcontextprotocol/sdk 1.32.1 (exact). Env: LIVEPULSE_API_URL,
          LIVEPULSE_SESSION_ID, LIVEPULSE_PRESENTER_KEY. Key → cookie exchange once; no Origin header; 8 tools; no
          session id in any tool input; stderr logs only; no DB import.
```

### Key decisions
1. **Approval runs through `presenter-commands.ts`**, shared with the poll and question controllers: same validation,
   authorization and emits by construction.
2. **The MCP never calls poll or answer write routes.** Every write is `POST /sessions/:id/ai/actions`.
3. **Approve and reject require an allowed Origin** (new `{ requireOrigin: true }` option on `createOriginCheck`; the
   default is unchanged). The MCP holds the same presenter cookie, so this stops a non-browser client approving its own
   proposals. **Open question A.**
4. **`LIVEPULSE_SESSION_ID` added to the MCP env**: `presenter-access` takes the session id in the path, and keys are
   stored hashed with no lookup route. **Open question B.**
5. **Key exchange once**, re-exchange once on 401, cache a 401 from `presenter-access` (limit 10 per 15 min).
6. **Two transactions plus a compare-and-set claim.** A row stuck in APPROVED is handled by the startup sweep.
7. **Session end**: PROPOSED → REJECTED with `error_code = SESSION_ENDED`, in the `endSession` transaction.
8. **Propose and approve need AI on; reject is always allowed.** Existing proposals stay PROPOSED when AI is off.
9. **Proposal time checks only that the target exists in the session**; execution re-validates through the real service.
10. **Outcomes reach Claude through `get_session_snapshot`** (10 most recent proposals); the tool list stays at 8.
11. **PUBLISH_ANSWER** runs the same path as the web's manual answer (`PATCH /questions/:id`).
12. **`suggest_polls`** posts a request, then polls the job every 1 s for up to 30 s; on timeout returns PENDING and the jobId.
13. **`list_questions`** returns visible questions only, max 50; audience text marked as untrusted data.
14. **No `livepulse://` resource.** Surface limited to the tool list.
15. **`@modelcontextprotocol/sdk` 1.32.1 exact.** Published 2026-10-05 (over two weeks old). Peer `zod ^3.25 || ^4`; repo has zod 3.25.76.

### Contracts
**Shared** `shared/src/schemas/ai-actions.ts`:
- `AI_ACTION_TYPES = ['CREATE_POLL','START_POLL','CLOSE_POLL','PUBLISH_ANSWER']`
- `AI_ACTION_STATUSES = ['PROPOSED','APPROVED','REJECTED','EXECUTED','FAILED']`
- `proposeActionBodySchema`: strict discriminated union on `type`: CREATE_POLL (`createPollBodySchema`); START_POLL /
  CLOSE_POLL (`{ pollId: uuid }`); PUBLISH_ANSWER (`{ questionId: uuid, text }`).
- `AiActionDto`: `{ id, type, status, details, resultId|null, errorCode|null, errorMessage|null, createdAt, decidedAt|null, finishedAt|null }`. No participant identifiers.
- `AI_ACTION_LIMITS`: 20 open proposals per session; propose 30/min per session; approve/reject 60/min per session.

**HTTP** (presenter cookie for `:id`; mounted inside `if (ai)` in `app.ts`):

| Method | Path | Success | Errors | Caller |
|---|---|---|---|---|
| POST | `/sessions/:id/ai/actions` | 201 `AiActionDto` (PROPOSED) | 400; 401 `PRESENTER_AUTH_REQUIRED`; 403 `FORBIDDEN_ORIGIN` (foreign Origin only); 404 (session, or poll/question not in session); 409 `SESSION_ENDED`, `AI_OFF_FOR_SESSION`, `PROPOSAL_LIMIT_REACHED`; 429; 503 `AI_DISABLED` | MCP |
| GET | `/sessions/:id/ai/actions` | 200 `{ actions }` newest first, max 50 | 401; 404 | web, MCP |
| POST | `/sessions/:id/ai/actions/:actionId/approve` | 200 `{ action }` (EXECUTED or FAILED) | 400; 401; 403 (missing or foreign Origin); 404; 409 `ACTION_NOT_PROPOSED`, `SESSION_ENDED`, `AI_OFF_FOR_SESSION`; 429; 503 | web only |
| POST | `/sessions/:id/ai/actions/:actionId/reject` | 200 `{ action }` (REJECTED) | 400; 401; 403; 404; 409 `ACTION_NOT_PROPOSED`; 429 | web only |

An execution failure is **not** an HTTP error: approve returns 200 with `status: FAILED` and an `errorCode`.

**Socket**: `'ai-action:updated': { sessionId, actionId, type, status }`, presenter room only, after commit on propose,
claim, settle and reject. Session-end expiry emits nothing (`session:ended` already hides the panel).

**MCP tools** (strict Zod inputs; none takes a session id):

| Tool | Input | Calls |
|---|---|---|
| `get_session_snapshot` | `{}` | `/sessions/:id/state`, `/polls`, `/questions` (top 5 visible), `/ai/actions` (10 most recent) |
| `suggest_polls` | `{}` | POST `/poll-suggestions`, then GET `/:jobId` (30 s cap) |
| `list_questions` | `{}` | GET `/questions` (visible, max 50) |
| `get_session_report` | `{}` | GET `/report` |
| `propose_create_poll` | `createPollBodySchema` | POST `/ai/actions` CREATE_POLL |
| `propose_start_poll` | `{ pollId }` | POST `/ai/actions` START_POLL |
| `propose_close_poll` | `{ pollId }` | POST `/ai/actions` CLOSE_POLL |
| `propose_publish_answer` | `{ questionId, text }` | POST `/ai/actions` PUBLISH_ANSWER |

Tool errors: `isError: true` with the API `code` and `message` only. Never the key or cookie.

### Files
| File | Create/Modify | Purpose | Risk |
|---|---|---|---|
| `shared/src/schemas/ai-actions.ts` (+ test) | Create | Types, statuses, propose union, DTO, limits | MEDIUM |
| `shared/src/events/realtime.ts`, `shared/src/index.ts` | Modify | `ai-action:updated`; exports | MEDIUM |
| `api/migrations/<ts>-create-ai-actions.cjs` | Create (generator) | Table, enums, CHECKs, indexes; real `down` | HIGH |
| `api/src/models/ai-action.model.ts`, `models/index.ts` | Create/Modify | Model, Session association (CASCADE) | MEDIUM |
| `api/src/services/presenter-commands.ts` | Create | `runCreatePoll/StartPoll/ClosePoll/ModerateQuestion` with after-commit emits | HIGH |
| `api/src/controllers/polls.controller.ts`, `questions.controller.ts` | Modify | Call presenter-commands; no behaviour change | MEDIUM |
| `api/src/services/ai-actions.service.ts` | Create | propose/list/approve/reject, claim/settle, DTO, stale sweep | HIGH |
| `api/src/services/sessions.service.ts` | Modify | `endSession` expiry in the same transaction | HIGH |
| `api/src/middleware/origin-check.ts` (+ test) | Modify | Optional `{ requireOrigin }` | HIGH |
| `api/src/controllers/ai-actions.controller.ts`, `api/src/routes/ai-actions.routes.ts` | Create | HTTP layer, limiters, strict origin on approve/reject | MEDIUM |
| `api/src/app.ts` | Modify | Mount router in `if (ai)` | LOW |
| `api/src/realtime/ai.ts` | Modify | `emitAiActionUpdated` (presenter room) | MEDIUM |
| `api/src/ai/startup.ts` | Modify | Stale-APPROVED sweep | MEDIUM |
| `api/src/mcp/env.ts` | Create | Zod env; errors never echo values | MEDIUM |
| `api/src/mcp/livepulse-client.ts` | Create | Key→cookie, 401 retry once, auth latch, no Origin, timeouts, error mapping | HIGH |
| `api/src/mcp/tools.ts` | Create | 8 tools | MEDIUM |
| `api/src/mcp/server.ts` | Create | stdio entry; logger to stderr | LOW |
| `api/package.json`, `package-lock.json` | Modify | SDK exact pin; `mcp` script | MEDIUM |
| `api/tests/integration/ai-actions-*.test.ts`, `api/tests/realtime/ai-actions-events.test.ts`, `api/tests/integration/mcp-*.test.ts` | Create | Tests | – |
| `web/src/lib/api/ai-actions-client.ts` | Create | list/approve/reject | LOW |
| `web/src/realtime/session-socket-state.ts`, `use-session-socket.ts` | Modify | `aiActionUpdated` listener | MEDIUM |
| `web/src/hooks/use-ai-actions.ts` | Create | Snapshot, refetch on event and reconnect | MEDIUM |
| `web/src/hooks/use-presenter-polls.ts` | Modify | Refetch on EXECUTED CREATE_POLL | LOW |
| `web/src/components/ai/AiProposals.tsx` (+ test), `AiPanel.tsx` | Create/Modify | Proposal list, Approve/Reject, FAILED reason | MEDIUM |
| `.env.example`, `docs/09`, `docs/guides/mcp-claude-desktop-setup.md`, `docs/04`, `docs/05`, `docs/10` §5.6, `docs/07` | Modify/Create | Placeholders, setup guide, contracts | LOW |

### Impact analysis
- **Breaking changes**: none for existing clients. The controller refactor keeps responses and emits identical; existing
  route and realtime tests must pass unchanged. The origin-check default is unchanged.
- **Migration**: one table `ai_actions` (id, session_id FK CASCADE, type enum, status enum default PROPOSED, payload
  jsonb, result_id, error_code, error_message, decided_at, finished_at, timestamps). CHECKs: payload is an object and
  ≤ 4096 bytes; FAILED requires error_code. Indexes: `(session_id, created_at DESC)`; partial `(session_id) WHERE
  PROPOSED`; partial `(updated_at) WHERE APPROVED`. **Down drops the table and enums and deletes proposals; test DB only
  until approved.**
- **Concurrency**: every transition is `UPDATE … WHERE status = <expected> RETURNING`; one of two competing approvals
  gets 409. Approve against session end: end and claim lock order is session row; the loser fails cleanly. The open-limit
  is a soft count under FOR SHARE (same trade-off as the poll limit).
- **Security**: no write without an APPROVED row; approval needs a browser Origin and the presenter cookie. MCP is bound
  to `LIVEPULSE_SESSION_ID`; target ownership is checked at proposal and execution. Key read from env only, redacted.
  stdout is the protocol channel, so logs go to stderr. Audience text is untrusted in tool output. A test asserts no DB
  or file-system imports in `api/src/mcp/`.
- **Testing**: integration tests on real Postgres; MCP tests use `InMemoryTransport` plus a test app on an ephemeral
  port; fake AI provider; no network.

### Tasks (v1)
| # | Task | Complexity | Executor | Depends | Verify |
|---|---|---|---|---|---|
| 1 | Shared ai-actions schemas, DTO, limits; `ai-action:updated`; exports | MEDIUM | executor-medium | – | shared tests + typecheck |
| 2 | Migration (table, enums, CHECKs, indexes, real down) | HIGH | executor-high | 1 | up → down → up on test DB; CHECK test |
| 3 | `AiAction` model + association | MEDIUM | executor-high | 2 | model integration test |
| 4 | Extract `presenter-commands.ts`; switch poll and question controllers (no behaviour change) | HIGH | executor-high | – | existing poll and Q&A route and realtime tests pass unchanged |
| 5 | `ai-actions.service.ts` (propose, list, claim/execute/settle, reject, sweep); `endSession` expiry | HIGH | executor-high | 3, 4 | transition, race, end-expiry, FAILED-code, no-write-before-approval tests |
| 6 | `createOriginCheck` `{ requireOrigin }` + unit test | MEDIUM | executor-high | – | origin-check test |
| 7 | `emitAiActionUpdated` after commit | MEDIUM | executor-high | 5 | realtime test: presenter receives, participant does not; no text in payload |
| 8 | Controller, routes, limiters; mount in `app.ts`; sweep in `ai/startup.ts` | MEDIUM | executor-medium | 5, 6, 7 | route tests: 201/200, 400, 401, 403, 404, 409, 429, 503 |
| 9 | Install `@modelcontextprotocol/sdk@1.32.1` (exact, `-w api`); `mcp` script; `npm audit` | LOW | inline | – | `npm ls`; lockfile diff review |
| 10 | `mcp/env.ts` + `mcp/livepulse-client.ts` | HIGH | executor-high | 8, 9 | client tests against test app: wrong-key latch, no Origin, key absent from logs |
| 11 | `mcp/tools.ts` (8 tools) + `mcp/server.ts` | HIGH | executor-high | 10 | InMemoryTransport tests: tool list, cross-session 404, propose→approve→`poll:started`, reject no-op, restart survival, no-DB-import |
| 12 | Web client, socket listener, `use-ai-actions` | MEDIUM | executor-medium | 1, 8 | hook and socket tests |
| 13 | `AiProposals` in `AiPanel`; polls refetch on EXECUTED CREATE_POLL | MEDIUM | executor-medium | 12 | component tests: states, pending, FAILED reason, plain text |
| 14 | Docs: setup guide (Claude Desktop + Claude Code), `.env.example`, docs 04/05/07/09/10 | LOW | executor-low | 11, 13 | review; clean-config check by operator |

Groups: 1 → 2–3 (executor-high) → 4 (executor-high) → 5–7 (executor-high) → 6 can join the same group → 8
(executor-medium) → 9 (inline, after install approval) → 10–11 (executor-high) → 12–13 (executor-medium) → 14 (executor-low).

### Approvals needed
- Install `@modelcontextprotocol/sdk@1.32.1` (package approved in principle on 2026-10-25; the install needs a go-ahead).
- Run the migration on the dev DB (additive; its down is destructive, test DB only).
- Open question A: approve and reject require a present, allowed Origin.
- Open question B: a third env var `LIVEPULSE_SESSION_ID` in the Claude Desktop config.

### Risks
| Level | Risk | Mitigation |
|---|---|---|
| HIGH | A write runs without approval | MCP has no write routes; approve needs a browser Origin; tests assert nothing is written before approval |
| HIGH | Key leaks through logs or stdout | stderr logger with redaction; env errors without values; test captures logs |
| HIGH | Controller refactor changes behaviour | Task 4 alone; existing suites must pass unchanged |
| HIGH | `endSession` change (shared lock path) | One UPDATE after existing statements, same lock order; existing end tests plus a new expiry test |
| MEDIUM | Stuck APPROVED rows after a crash | Startup sweep with age guard; shown as FAILED/INTERRUPTED |
| MEDIUM | Action marked FAILED although the command ran (crash window between two transactions) | INTERRUPTED message tells the presenter to check; accepted for prototype |
| MEDIUM | SDK API drift | Exact pin; tool-list test |
| MEDIUM | Prompt injection through audience question text | Untrusted-data wrapper; writes are proposals only |
| LOW | Setup guide drifts | Clean-config check (success criterion 6) |

## Approval
- Plan v1 approved by the developer on 2026-10-25: all 14 tasks; SDK install at 1.32.1; migration on the test DB
  first (dev DB migration needs a separate go-ahead). Origin rule accepted (approve and reject need an allowed Origin).
  `LIVEPULSE_SESSION_ID` added as a third env var.

## Tasks (status)
| # | Status | Notes |
|---|---|---|
| 9 | done (install) | `@modelcontextprotocol/sdk@1.32.1` installed exact in api; `mcp` script to be added with task 11 (file does not exist yet) |
| 1 | done (verified) | shared schemas; shared tests 143/143 exit 0; typecheck exit 0 |
| 4 | done (verified) | presenter-commands extraction. Typecheck api exit 0; targeted integration (polls/questions/qna/poll-live/poll-secrecy/end-closes-poll, 21 files) 171/171 exit 0; unit 157/157 exit 0. Re-run after an earlier memory-kill |
| 2 | done (verified on test DB) | migration `create-ai-actions` (.cjs): up → undo → up all exit 0 on livepulse_test; dev DB not migrated (needs separate approval) |
| 3 | done (verified) | AiAction model + Session association; ai-actions-model 4/4 exit 0; typecheck exit 0 |
| 5 | done (verified) | ai-actions service; endSession expiry. typecheck exit 0; ai-actions-service 17/17 exit 0; end suites 20/20 exit 0. Gap: no test for a settle-transaction failure (row stays APPROVED until sweep) |
| 7 | done (verified) | emitAiActionUpdated; ai-actions-events 4/4 exit 0 |
| 10 | done (verified) | MCP env and client. typecheck exit 0; mcp-client 8/8 exit 0; unit 166/166 exit 0 |
| 11 | done (verified) | MCP tools (8), stdio entry, `mcp` script. typecheck exit 0; src/mcp unit 10/10 exit 0; mcp-tools 8/8 exit 0; regression ai-actions+mcp-client 48/48 exit 0. Not run: Claude Desktop itself; `suggest_polls` against the real API |
| 12, 13 | done (verified) | web client, socket listener, use-ai-actions hook, AiProposals panel. web typecheck exit 0; web tests 197/197 exit 0. Gaps: hook behaviours (refetch on event/reconnect, pending) have no unit tests; real browser not run |
| Stdio check | done (partial) | Real MCP server process (`npx tsx src/mcp/server.ts`, the same code as `npm run mcp`) driven over stdio with the MCP SDK client against the dev API, using a throwaway session: 8 tools listed exactly; snapshot ok; create-poll → proposal "Awaiting approval"; no poll before approval; stored as PROPOSED; reject from web origin 200; no poll after reject (8/8 exit 0). Not done: approve path through the live server (covered by integration tests only); Claude Desktop and Claude Code themselves |
| 14 | done (docs) | setup guide, `.env.example` placeholders, docs 04/05/07/09/10. Fixed docs/10 §5.6 (removed a non-existent resource; added LIVEPULSE_SESSION_ID). Unverified: guide's AI-toggle location and the Claude Code `--cwd` flag |
| 8 | done (verified) | routes/controller/limiters; app.ts mount; startup sweep. typecheck exit 0; ai-actions-routes 15/15 exit 0; service+events 21/21 exit 0. Deviation: a cookie from another session gets 401 (per-session cookie name, same as existing routes); unknown session gets 404 |
| 6 | done (verified) | origin-check `requireOrigin`; origin-check tests 9/9 exit 0; api typecheck exit 0 |
| 2–3, 5–8, 10–14 | pending | |

## Issues & updates
<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-25 | plan_created | Requirement written from developer answers (all writes gated; approve package and ai_actions migration; drop list_my_sessions; leave out get_insights) | requirement.md |
| 2026-10-25 | plan_created | Plan v1 drafted by planner; 14 tasks; open questions A (Origin rule) and B (LIVEPULSE_SESSION_ID); awaiting approval | planning-tracking.md |
| 2026-10-25 | approved | Plan v1 approved (all 14 tasks; SDK 1.32.1 install; migration on test DB first; Origin rule; LIVEPULSE_SESSION_ID) | planning-tracking.md |
| 2026-10-25 | verified | Full API integration suite: 86 files, 599 passed, 1 skipped, exit 0. Unit 166/166 exit 0 (api). Web tests 197/197 exit 0. Shared 143/143 exit 0. Typecheck api, web, shared exit 0 | planning-tracking.md |
| 2026-10-25 | verified | Settle-failure test added (approve leaves row APPROVED; sweep marks INTERRUPTED). ai-actions-service 18/18 exit 0; typecheck api exit 0. No production change | ai-actions-service.test.ts |
| 2026-10-25 | not_done | Dev DB migration `create-ai-actions` NOT applied (needs separate approval). Manual checks not run: Claude Desktop/Code, real browser, clean-config setup guide, guide's AI-toggle location, `--cwd` flag. Hook behaviours (refetch on event/reconnect, pending) have no unit tests | planning-tracking.md |
