# 07 — Test Plan

## 1. Layers

- **Unit:** validators, normalisation, chunking, thresholds, budget math, prompt builders, graph routing functions.
- **Service (integration):** Sequelize services against a real test PostgreSQL (with pgvector).
- **API:** Vitest + Supertest.
- **Socket:** Socket.IO client against a test server; cross-instance test with two servers + one Redis.
- **AI:** chains and graphs with the `fake` LLM provider and deterministic `fake` embeddings — no network, no cost.
- **MCP:** call tool handlers directly and through an in-memory MCP client transport.
- **UI:** component tests for states (loading/empty/error/AI pending/AI failed).
- **Manual E2E:** demo script in `12`.
- **Opt-in AI eval:** real model against the golden set (`10` §9); run only with approval; report measured numbers.

Test names describe business behaviour, e.g. `rejects a second vote from the same participant`.

## 2. Critical scenarios

### Session & participants

Valid creation · invalid title · room-code collision retried · presenter key required and session-scoped ·
invalid code → safe error · ended session rejects joins/submissions · token scoped to one session · tokens never
in other payloads or logs · refresh restores state.

### Polls & votes

2–6 options · one active poll per session · invalid transitions → 409 · option from another poll rejected (and
by the DB) · closed poll rejects votes · visibility enforced server-side · **concurrent duplicate votes → exactly
one row** · distinct concurrent voters all persist · close/vote race follows the row-lock rule · failed
transaction emits nothing.

### Word cloud

Empty/oversized rejected · whitespace and casing normalised · script-like text rendered as text · one response
per participant per prompt · rate limit · empty cloud returns `{ total: 0, version: 0, entries: [] }` · stable top-N ordering.

### Q&A

Submit + rate limit · 5-question cap under parallel submits (six → five) · same text twice → one row, 409 ·
one upvote per participant (concurrent or two-tab upvotes → one) · cannot upvote own question (403) · hidden question
upvote → 404 · upvote count matches rows · ordering by upvotes then age, pinned first · participants never receive
hidden questions over HTTP or socket · pin race → one pinned · close and end vs submit · presenter-only moderation
(401 without the presenter cookie) · answers and pins broadcast as `question:updated`.

### Reactions

Unknown emoji rejected · rate limit per participant · bursts aggregated (N taps → one burst event per window) ·
flushed counts equal accepted taps · reduced-motion respected in UI.

### Real-time

Authorized join only · invalid credential cannot join · cannot subscribe to another session · presenter room
isolation (participant never receives `ai:*` or held questions) · acks carry correct codes · two-instance
broadcast via Redis · reconnect → state fetch · Redis outage policy · stale/duplicate events ignored by clients.

### AI foundation

Provider selected from env · `fake` provider deterministic · missing API key fails startup only when
`AI_PROVIDER=anthropic` · job claimed by exactly one runner (concurrent claim test) · retries then FAILED with safe
code · stale RUNNING jobs resumed on start · budget exceeded → SKIPPED + presenter event · `AI_ENABLED=false`
→ endpoints return `AI_DISABLED`, core flows unaffected · no LLM call inside a DB transaction · invalid model
output (schema mismatch) handled.

AI test groups (built): unit `ai/providers/providers.test.ts`, `ai/embeddings/embeddings.test.ts`, `ai/tasks/ping.test.ts`,
`shared/src/schemas/ai.test.ts`; integration `ai-jobs-service`, `ai-models`, `ai-routes`, `ai-runner`, `ai-startup`,
`pgvector-probe`; realtime `ai-events`; web `components/ai/ai-panel.test.tsx`. All use the `fake` provider, no network.

Opt-in live tests (never in default runs, cost money): `api/tests/live/anthropic-smoke.live.test.ts` (one real Claude
request) and `api/tests/live/local-embeddings.live.test.ts` (loads the local model, checks vector length 384). Run with
`npm run test:live -w api`; they are skipped unless `ANTHROPIC_API_KEY` is set (the smoke test) and `AI_LIVE_TEST=1`
(set by `vitest.live.config.ts`). Not run in this session.

### Knowledge base (RAG, built)

Groups (all use the fake extractor, fake embeddings and fake reranker; no network):

- **Unit (no database):** `api/src/knowledge/chunker.test.ts` (boundaries, overlap, page and size caps),
  `file-type.test.ts` (renamed files and invalid UTF-8 refused), `extractors/extractors.test.ts` (text, PDF, page and
  character caps, timeout), `reranker/reranker.test.ts`; `api/src/services/knowledge-search.test.ts` (fusion order and ties,
  threshold, fused order kept when the reranker fails); `shared/src/schemas/knowledge.test.ts` (names, query and limits).
- **Integration (test database):** `knowledge-models` (models and associations), `knowledge-service` (upload, limits,
  duplicates, AI off or ended session refused, delete cancels the waiting job), `knowledge-ingest` (upload to READY and
  searchable, failure reasons, a document removed or session ended during processing stores nothing), `knowledge-search`
  (rank order, session isolation, deleted documents not returned), `knowledge-routes` (size, type and rate limits; another
  session and a participant refused), `knowledge-session-end` (ending a session removes its documents and passages).
- **Realtime:** `api/tests/realtime/knowledge-events.test.ts`: status reaches the presenter room only; participants receive
  no document event; the payload carries no text or file name.
- **Web:** `web/src/hooks/knowledge-merge.test.ts` (status update merge, unknown ids ignored) and
  `web/src/components/knowledge/knowledge.test.tsx` (limits text, plain failure reasons, empty search, results with document
  name and location, unsupported file refused before sending).

Opt-in live checks (never in default runs; `AI_LIVE_TEST=1` is set by `api/vitest.live.config.ts`):

- `npm run test:live -w api` runs the live files under `api/tests/live/`.
- `pdf-extract.live.test.ts` (real `unpdf` on a fixture PDF) and `reranker.live.test.ts` (real local reranker puts a
  relevant passage first) need no API key. The first reranker run downloads the model into `api/.cache/models`.
- The Anthropic check needs `ANTHROPIC_API_KEY`; without it that file is skipped.
- Live results are reported only when they ran. Not run in the knowledge-base-rag verification so far.

### AI poll suggestions (ai-poll-generator, built)

All use the `fake` provider; no network. The fake returns a fixed valid reply when the system prompt carries the
`[task:suggest-polls]` marker. Malformed-output tests use a scripted provider.

- **Unit (no database):** `api/src/ai/tasks/suggest-polls.test.ts` (prompt delimiters; injected text stays inside the
  passage delimiters; parser rules: at most 3 items, 2–4 options, a bad item or a missing passage index dropped, duplicates
  handled, an empty list valid, unparseable output is `INVALID_OUTPUT`); `suggest-polls.run.test.ts` (task run with the
  fake and scripted providers: no ready passage means no provider call; malformed reply fails without a retry);
  `shared/src/schemas/poll-suggestions.test.ts` (limits and accepted and result schemas).
- **Integration (test database):** `poll-source-passages` (sampling: READY passages only, session scoped);
  `poll-suggestions-service` (one job per request, a repeat within 30 seconds returns the same job, no READY passage gives
  `NO_RELEVANT_PASSAGES` and stores no job, latest and by-job DTOs, a removed document's suggestion is not listed, another
  session's or another type's job is not found, latest is `null` after the session ends); `ai-enqueue-hook` (regression:
  an enqueue without the hook is unchanged; a refusing or shortcut hook stores no job); `poll-suggestions-routes` (202 for
  the presenter; 401 for a participant and a missing cookie; 404 for another session's job; 409 with AI off, over budget
  and with no relevant passage, no provider call when AI is off; 429 when repeated; latest is `null` after end);
  `poll-suggestions-flow` (end to end with the runner: three suggestions with sources; nothing stored as a poll until
  created; creating from a suggestion's values makes a normal draft poll; ending the session while a request waits cancels
  it and shows no suggestions).
- **Realtime:** `api/tests/realtime/poll-suggestions-events.test.ts`: presenter receives `poll-suggestions:ready`;
  participants do not; the payload carries no text.
- **Web (static markup and hooks):** `web/src/components/polls/poll-suggestions.test.tsx` (each state's text; "Use this"
  fills the form; nothing is created until Create), `web/src/hooks/poll-suggestions-dismissed.test.ts` (used suggestions
  hidden in the browser only).

Not covered by a test: the real model's reply, the live browser, and the request-created realtime path.

### AI Q&A copilot (ai-qna-copilot, built)

All use the `fake` provider; no network. Routing, prompts and parsers are covered without a database; node and service
behaviour runs against the test database.

- **Unit (no database):** `api/src/ai/tasks/qna-copilot/qna-prompts.test.ts` (question text cannot close its
  delimiter early; unknown moderation labels refused; the English query is read from the moderation reply; a draft over
  500 characters refused; an uncited grounded draft is unsupported; at most three citations kept; an unparseable
  self-check is invalid output); `graph.test.ts` (the graph starts at the step the question has reached);
  `nodes.test.ts` (the cluster centroid is the running mean).
- **Integration (test database):**
  - `qna-copilot-nodes`: toxic held; near-duplicate merged without a second draft; non-English compared by its English
    query; no knowledge base gives "not covered" with no model call; grounded draft held with citations; uncited draft
    retried once, then not covered; identical questions at the same moment give one draft; session end cancels a draft.
  - `qna-copilot-graph`: full run to a grounded draft; toxic ends held; a run that gives up releases its question;
    a draft still writing when the run gives up is cancelled; a resumed run at the draft step creates no second draft;
    a skipped run at session end is held; English query kept after a restart.
  - `qna-copilot-service`: review shows held and pending drafts with text; approve publishes the answer and citations
    without quote text; an edited approval publishes the edited text; no double approval; a question already answered
    by hand is refused; reject leaves the question open; release and reject of held questions; clusters empty below
    three; another session's draft not found.
  - `qna-copilot-routes`: participant and missing cookie refused (401); another session's draft is 404; approve returns
    the question; a second approve is 409; release and reject of a held question; repeated actions rate limited (429);
    clusters empty below three; a never-classified held question has no label.
  - `qna-copilot-session-end`: ending a session cancels open drafts, holds questions still checking, keeps visible
    questions and approved answers, and leaves other sessions untouched.
  - `qna-copilot-visibility`: other participants do not see checking or held questions; the asker sees their own
    checking status; a checking question cannot be upvoted; AI on queues one job; AI off or over budget shows the
    question at once with no job.
  - `qna-copilot-models`: defaults, the duplicate and approved-text constraints, cluster size and centroid, and cascade
    delete with the session.
- **Realtime:** `api/tests/realtime/qna-copilot-events.test.ts`: the presenter hears review and cluster changes; the
  room hears a released question once, an approved answer only as a refresh, and a merged duplicate only as a new
  count; participants hear nothing about held, checking or review decisions; a rejected question is never announced.
  `qna-live.test.ts` and `qna-secrecy.test.ts` cover the Q&A room rules.
- **Web (static markup):** `web/src/components/qna/copilot-review.test.tsx`: held question actions; draft text,
  citations and approve; "not covered" offers write by hand; edited text sent only when changed; the 409 copy; the
  clusters "needs three questions" state; participant status only on their own question; answers as plain text.

Not covered by a test: a real model's replies, the live browser, and the give-up release event (a question released
after a failed run sends `question:created`, with no test).

### Live insights

Themes group fixture synonyms · exact-count cloud unchanged by AI · debounce (no second job while one is
pending/fresh) · sentiment payload validated · no insight job when there is no new input.

### Session report & ask-session (built)

All use the `fake` provider; no network. Groups (requirement: `requirements/ai-session-report/`):

- **Unit (no database):** the report tool set over the report DTO (strict inputs with no session field, output caps, server source references and labels, unknown tools refused); the chat prompt (session data treated as untrusted, answers from tool results only); the client SSE parser.
- **Integration (test database):**
  - report: figures match the SQL aggregates; a session with no data says so; participants and other sessions' presenters refused.
  - export: the JSON equals the page's report DTO.
  - chat service: reserve, tool loop, settle; incomplete marking; budget and AI-off refusals before any provider call; history.
  - chat stream and routes: SSE events; refused JSON statuses before the stream; cross-session refused; closing the connection stops the provider call.
- **Realtime:** `ai:usage` after a chat answer reaches the presenter room only; participants receive no event from the report or the chat.
- **Web (static markup):** report states (loading, empty, error, populated); chat streaming text, `INCOMPLETE` marking, sources, AI-off and budget copy, `aria-live`.

Not covered by a test: a real model's answers, a real browser stream, and a real proxy (buffering).

### MCP server

- `api/tests/integration/mcp-client.test.ts`
- `api/tests/integration/mcp-tools.test.ts`
- `api/tests/integration/ai-actions-routes.test.ts`
- `api/tests/integration/ai-actions-service.test.ts`
- `api/tests/integration/ai-actions-model.test.ts`
- `api/tests/realtime/ai-actions-events.test.ts`
- `api/src/mcp/env.test.ts`
- `api/src/mcp/tools.test.ts`

### Infrastructure

`/health` and `/ready` leak nothing · env validation fails clearly · migrations `up`/`down` on a clean DB ·
graceful shutdown closes sockets, Redis, DB, and drains the AI runner · data survives restart.

## 3. Manual E2E

Follow the demo script in `12-demo-and-interview.md`, plus: two backend instances; kill the LLM key mid-demo and
confirm core features keep working.

## 4. Reporting rules

Exact commands and real results · automated vs manual separated · nothing marked passed unless it ran · list
environment-dependent or skipped tests (e.g. real-model eval) and remaining defects.
