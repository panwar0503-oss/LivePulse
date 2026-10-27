# ai-session-report — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Post-session report and "Ask your session"

### Architecture
- DB: `session_chat_turns` (new, cascade on session delete). The report has no table: it is computed from data that is
  final after the end.
- API: `GET /api/sessions/:id/report` (one read-only REPEATABLE READ transaction, aggregate queries); `.../report/export`
  (same DTO as JSON); `.../report/chat` (history); `POST .../report/chat` (reserve, tool loop, settle, SSE response).
- Realtime: no new events. Existing `ai:usage` goes to the presenter room after the settle commits.
- Web: `/presenter/[sessionId]/report` with SessionReport and ReportChat; `lib/api/report-client.ts` and `sse-parse.ts`.

### Key decisions
1. Tools read a report DTO built once per chat turn, for the session id the server already knows. Tools are pure over
   that snapshot and cannot write or reach another session.
2. The provider gets a real streaming method (`converse`) on `LlmProvider`: text deltas, tool calls, usage. Anthropic
   via `bindTools(...).stream()` from `@langchain/core` (installed); the fake runs a deterministic script.
3. The answer streams over SSE on the POST response, not the socket room: the stream belongs to one request, uses the
   presenter cookie, and participants cannot receive it. Aborting on disconnect stops the provider.
4. The server decides sources: each tool result carries server references (`poll:`, `prompt:`, `question:`,
   `document:`, `ai-usage`) that are mapped to labels. Citations the model writes are ignored.
5. Budget reuses the `ai_jobs` reservation: type `SESSION_REPORT`, status RUNNING, `max_attempts = 1`,
   `reserved_tokens = 8000`, `dedupe_key = 'report-chat'`. Settle charges real tokens and releases the reservation.
6. Export is JSON from the same validated DTO (deep-equal test).
7. One row per question and answer, with a bounded jsonb `sources` array.
8. Failed, aborted, timed-out (45 s), capped or over-round (4) answers are settled `INCOMPLETE` with an error code.

### Contracts
- All routes presenter-only (404 unknown session; 401 without that session's cookie).
- `GET …/report` → 200 `SessionReport`. `GET …/report/export` → JSON attachment. `GET …/report/chat` → `{ turns }`.
- `POST …/report/chat` body `{ clientMessageId uuid, question 1..500 }` strict. Refused as JSON before the stream: 400, 401,
  404, 429, 503 `AI_DISABLED`, 409 `AI_OFF_FOR_SESSION` | `AI_BUDGET_EXHAUSTED` | `CHAT_BUSY` | `DUPLICATE_MESSAGE`.
  Accepted: 200 `text/event-stream`. Events: `start`, `delta`, `tool` (name only), `done` (sources), `error` (fixed text).
- Shared: `shared/src/schemas/session-report.ts` (report, chat turn, stream events). Export contains no participant
  identifiers or display names.

### Database
- Migration `create-session-chat-turns`: id; session_id FK CASCADE with created_at index; client_message_id uuid unique
  per session; question varchar(500); answer text CHECK ≤ 8000; status enum; error_code; sources jsonb; ai_job_id FK SET NULL.
- **Down is destructive** (drops chat history). Test database only until approved.

### Concurrency
- Report: one REPEATABLE READ, READ ONLY transaction.
- Chat: reserve under session FOR UPDATE (runner's lock order); one streaming turn per session via the dedupe index;
  client id unique absorbs double sends.
- Tools never write. AI switched off during a stream: settle marks INCOMPLETE with `AI_OFF_FOR_SESSION`.

### Security
- Presenter-only on all routes. Tool inputs strict with no session field. Unknown tools return an error result and are not run.
- Output caps: 20 rows, 200 characters per text field, 4,000 per result. Results wrapped in `<session_data tool="…">`;
  the system prompt says the data is untrusted and to answer from tool results only.
- Last 3 turns of context, truncated. Logs carry ids, counts and codes only.

### Tasks (v1)
| # | Task | Cx | Executor | Depends | Verify |
|---|---|---|---|---|---|
| 1 | Report, chat and stream-event schemas, exported | LOW | executor-low | – | shared tests |
| 2 | Chat constants; `CHAT_BUSY`, `DUPLICATE_MESSAGE` codes | LOW | inline | 1 | typecheck |
| 3 | Migration, model, association (up/down/up on test DB) | MEDIUM | executor-medium | 1 | migrations |
| 4 | Report builder in one read-only transaction | MEDIUM | executor-medium | 1 | integration: numbers match; stable after end |
| 5 | Report and export routes and controller | MEDIUM | executor-medium | 4 | Supertest 200/401/404; export equals report |
| 6 | `converse` on the provider; Anthropic and fake script | HIGH | executor-high | 2 | unit, no network |
| 7 | Tool set over the DTO: schemas, caps, source refs and labels | MEDIUM | executor-medium | 1, 4 | unit |
| 8 | Versioned, delimiting prompt | LOW | executor-low | 7 | unit |
| 9 | Chat service: reserve, tool loop, settle, incomplete marking, history | HIGH | executor-high | 3, 6, 7, 8 | integration (see Testing) |
| 10 | SSE controller and routes; abort on close | HIGH | executor-high | 9 | Supertest stream; cross-session refused |
| 11 | `ai:usage` after settle | LOW | inline | 9 | socket test |
| 12 | Report client, SSE parser, export download | MEDIUM | executor-medium | 1, 10 | unit |
| 13 | SessionReport component (all states, throttled refetch) | MEDIUM | executor-medium | 12 | static markup |
| 14 | ReportChat (streaming, incomplete, sources, AI-off and budget copy, aria-live) | MEDIUM | executor-medium | 12 | static markup |
| 15 | Report page and link after end | LOW | executor-low | 13, 14 | web typecheck and tests |
| 16 | Docs: API contract, AI architecture section 5.5 | LOW | executor-low | 10 | review |

Groups: G1 (1–2) → G2 (3) → G3 (4–5) → G4 (6–8) → G5 (9–11) → G6 (12–15) → G7 (16).

### Approvals needed
- No new packages. Streaming and tool binding come from installed `@langchain/core` 1.3.0 and `@langchain/anthropic` 1.6.0.
- One migration; its down drops chat history (test DB only).
- Shared path changes: new schema file, `shared/src/index.ts`, two AI error codes.
- Provider interface change: `converse` added to `LlmProvider`.
- Four new presenter routes.

### Risks
| Level | Risk | Mitigation |
|---|---|---|
| HIGH | Invented numbers | Tool-only data; server-decided sources; required not-in-data test |
| HIGH | Cross-session read or write | Tools bound to the server's session; strict schemas; tests against a second session |
| MEDIUM | Reservation leak on crash | `max_attempts = 1`; recovery fails and releases; history maps orphans to INCOMPLETE |
| MEDIUM | SSE buffered by a proxy or helmet | No compression; `X-Accel-Buffering: no`; stream test |
| MEDIUM | Conflicts with uncommitted copilot work (shared index, models index, migrations) | Land after the copilot tasks, or rebase; generated timestamps |
| LOW | Slow report at 500 participants | Aggregates on existing indexes |

### Open questions (with recommendations)
1. **Documents are deleted at session end**, so after the end the report cannot name them. Recommended: show "Documents are removed when the session ends" plus a count of successful ingest jobs. The alternative is a snapshot column (another migration).
2. **Chat after the end.** AI cannot be turned on after the end, so a session that ended with AI off can never chat. Recommended: allow chat after the end when AI was on, and accept this limitation.
3. **Export format.** Recommended: JSON now; Markdown later from the same DTO.
4. **Refusal wording.** Recommended: the web maps codes to chat-specific text; server messages stay as they are.
5. **"Top" questions.** Recommended: visible, not-hidden questions only; counts include every review state, labelled.

## Approval
- Plan v1 approved by the developer on 2026-10-25 with the recommended answers: JSON export; chat allowed after the end when AI was on; documents shown as removed with a count of successful ingest jobs; one migration (its down drops chat history, test DB only); `converse` added to the provider; four presenter routes.
- Sequencing (developer choice, 2026-10-25): build after `ai-qna-copilot` is finished, to avoid conflicts on shared files and migration history. Copilot build finished 2026-10-25 (live checks pending); execution started.

## Decisions
<!-- Filled after the developer answers the open questions and approves. -->

## Issues & updates
<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-25 | plan_created | Plan v1 drafted by planner; five open questions with recommendations; one migration (test-DB-only down); provider interface change; awaiting approval | planning-tracking.md |
| 2026-10-25 | verified | Full API integration suite run alone: 80 files, 543 passed, 1 skipped, exit 0. API typecheck exit 0; unit 157/157; web 187. Live model and browser checks not run | planning-tracking.md |
