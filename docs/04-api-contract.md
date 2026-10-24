# 04 — REST API Contract

## 1. Conventions
- Base path `/api`. JSON in/out except document upload (multipart).
- Success: `{ "success": true, "data": … }` · Error: `{ "success": false, "error": { "code", "message", "details"? } }`
- Stable error codes (e.g. `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `SESSION_ENDED`,
  `POLL_NOT_ACTIVE`, `VOTE_ALREADY_RECORDED`, `RATE_LIMITED`, `AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_UNAVAILABLE`).
- No stack traces, SQL, secrets, hashes, embeddings, or internal hosts in responses.

### Auth headers
- Presenter: `Authorization: Bearer <presenterKey>` — must match the session in the path.
- Participant: `X-Participant-Token: <token>` — must belong to the session of the target resource.
- Room code is discovery only, never authorization.

## 2. Endpoints

Legend: **P** presenter · **A** participant · **Pub** public. Phase in brackets.

### Sessions & participants [3]
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/sessions` | Pub | `{ title, description? }` → `201 { sessionId, roomCode, joinUrl, presenterKey }` (key shown once) |
| GET | `/sessions/:id` | P | Presenter view incl. counts and AI settings |
| GET | `/sessions/by-code/:code` | Pub | Safe public fields only |
| POST | `/sessions/:id/join` | Pub | `{ displayName }` → `201 { participantId, participantToken, session }` |
| GET | `/sessions/:id/state` | P or A | Full snapshot for (re)connect: active poll, results if allowed, open prompt, questions, reaction totals |
| POST | `/sessions/:id/end` | P | Idempotent; `200` if already ended |
| PATCH | `/sessions/:id/settings` | P | `{ aiEnabled?, qnaOpen?, aiModeration? }` [7/9] |

### Polls & votes [5]
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/sessions/:id/polls` | P | `{ question, options[2–6], showResults, sourceSuggestionId? }` → DRAFT |
| POST | `/polls/:id/start` | P | DRAFT → ACTIVE; `409` if another poll is active |
| POST | `/polls/:id/close` | P | ACTIVE → CLOSED |
| PATCH | `/polls/:id` | P | `{ showResults }` |
| POST | `/polls/:id/votes` | A | `{ optionId }` → `201`; duplicate → `409 VOTE_ALREADY_RECORDED` |
| GET | `/polls/:id/results` | P or A | Visibility enforced server-side |

### Word cloud [6]
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/sessions/:id/word-prompts` | P | `{ prompt }` → OPEN (closes any open prompt) |
| POST | `/word-prompts/:id/close` | P | |
| POST | `/word-prompts/:id/responses` | A | `{ text }` → `201`; second → `409` |
| GET | `/word-prompts/:id/cloud` | P or A | `{ items: [{ word, count }] }` top-N |

### Q&A [7]
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/sessions/:id/questions` | A | `{ text }` → `201 { question }` (status may be `PENDING_REVIEW`) |
| GET | `/sessions/:id/questions` | P or A | Participants get `VISIBLE`/`ANSWERED` only; presenter gets all, filter by `status` |
| POST | `/questions/:id/upvote` | A | `201`; duplicate `409`; own question `403` |
| PATCH | `/questions/:id` | P | `{ status?: HIDDEN|VISIBLE|ANSWERED|REJECTED, pinned?, answerText? }` |

### Reactions [8]
Sent over socket only (`reaction:send`). `GET /sessions/:id/reactions/summary` (P or A) returns totals and a
per-minute timeline.

### AI — knowledge base [10]
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/sessions/:id/knowledge` | P | multipart `file` (PDF/MD/TXT, size + page limits) → `202 { documentId, status: PROCESSING }` |
| GET | `/sessions/:id/knowledge` | P | Documents with status and chunk count |
| DELETE | `/knowledge/:documentId` | P | Deletes document + chunks |
| POST | `/sessions/:id/knowledge/search` | P | `{ query, k? }` → chunks with scores (debug/demo of retrieval) |

### AI — features [11–14]
| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/sessions/:id/ai/poll-suggestions` | P | `{ instruction?, count? }` → `202 { jobId }`; results via `ai:poll-suggestions-ready` |
| GET | `/sessions/:id/ai/poll-suggestions` | P | Latest suggestions |
| POST | `/ai/poll-suggestions/:id/dismiss` | P | |
| GET | `/sessions/:id/ai/answer-drafts` | P | Pending drafts with citations |
| POST | `/ai/answer-drafts/:id/approve` | P | `{ finalText? }` → publishes answer, `200` |
| POST | `/ai/answer-drafts/:id/reject` | P | |
| POST | `/questions/:id/release` | P | Release a held question to `VISIBLE` |
| POST | `/sessions/:id/ai/insights/refresh` | P | `202 { jobId }` (debounced; `200` with latest if fresh) |
| GET | `/sessions/:id/ai/insights` | P | Latest of each kind |
| GET | `/sessions/:id/ai/report` | P | Report (generated when session ends; `202` if still running) |
| POST | `/sessions/:id/ai/ask` | P | `{ question }` → streamed answer (SSE `text/event-stream`: `token`, `citations`, `done`, `error`) |
| GET | `/sessions/:id/ai/usage` | P | Tokens used / budget, jobs by status |
| GET | `/ai/jobs/:id` | P | Job status (must belong to presenter's session) |

### Ops
`GET /health` (liveness) · `GET /ready` (`503` if PostgreSQL or required Redis is down; AI status informational).

## 3. Status codes
200 read/idempotent · 201 created · 202 accepted (async AI job) · 400 malformed · 401 missing/invalid credential ·
403 wrong role/session · 404 absent or concealed · 409 duplicate / invalid lifecycle · 413 upload too large ·
415 unsupported file type · 429 rate limited · 500 generic · 503 dependency unavailable (incl. `AI_UNAVAILABLE`).

## 4. Implementation checklist
Zod for params/query/body · DTO mappers · auth middleware per role · rate limits (join, vote, word, question,
upvote, AI endpoints) · body/upload size limits · request IDs + structured logs · Sequelize unique-violation
mapping · tests for success, 400, 401, 403, 404, 409, 429 and dependency failure.
