# 04 — REST API Contract

## 1. Conventions

- Base path `/api`. JSON in/out except document upload (multipart).
- Success: `{ "success": true, "data": … }` · Error: `{ "success": false, "error": { "code", "message", "details"? } }`
- Stable error codes (e.g. `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `SESSION_ENDED`,
  `POLL_NOT_ACTIVE`, `VOTE_ALREADY_RECORDED`, `RATE_LIMITED`, `AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_UNAVAILABLE`).
- No stack traces, SQL, secrets, hashes, embeddings, or internal hosts in responses.

### Auth (cookies, not bearer headers)

- One HttpOnly cookie per session and role: `lp_presenter_<sessionId>` and `lp_participant_<sessionId>`.
  Flags: `HttpOnly; SameSite=Lax; Path=/api; Max-Age=7 days`; `Secure` only when `NODE_ENV=production`.
- The presenter key is returned once by `POST /sessions`, then lives only in the presenter cookie. The cookie
  must match the session in the path. Cookies hold raw random tokens; the server stores SHA-256 hashes only.
- Participant cookie is set by join and must belong to the session of the target resource.
- Room code is discovery only, never authorization.
- POST requests need an `Origin` header that matches `WEB_ORIGIN`; otherwise `403 FORBIDDEN_ORIGIN`.

## 2. Endpoints

Legend: **P** presenter · **A** participant · **Pub** public. Phase in brackets.

### Sessions & participants [3]

| Method | Path                                     | Who | Notes                                                                                                                                                                                                                                                                                                                                                  |
| ------ | ---------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/sessions`                              | Pub | `{ title, description? }` → `201 { sessionId, roomCode, joinUrl, presenterKey }` + presenter cookie; rate limited 10 per IP per hour                                                                                                                                                                                                                   |
| GET    | `/sessions/:id`                          | P   | Presenter view: `{ id, title, description, roomCode, joinUrl, status, endedAt, participantCount }`; AI settings added later                                                                                                                                                                                                                            |
| GET    | `/sessions/by-code/:code`                | Pub | `{ title, status, roomCode }` only; shares the join rate limit (20 per IP per minute)                                                                                                                                                                                                                                                                  |
| POST   | `/sessions/by-code/:code/join`           | Pub | `{ displayName }` → `201` (`200` if this browser already joined) `{ participant, session }` + participant cookie                                                                                                                                                                                                                                       |
| GET    | `/sessions/by-code/:code/participant-me` | A   | Restores the participant view from the participant cookie: `200 { participant, session }`; `401` without a matching cookie                                                                                                                                                                                                                             |
| POST   | `/sessions/:id/presenter-access`         | Pub | `{ presenterKey }` → `204` + presenter cookie; rate limited per session                                                                                                                                                                                                                                                                                |
| POST   | `/sessions/:id/end`                      | P   | Ending is final; repeat call returns `200` with the same `endedAt`                                                                                                                                                                                                                                                                                     |
| GET    | `/sessions/:id/state`                    | P   | Presenter snapshot for (re)connect: `200 { id, title, roomCode, status, endedAt, joinedCount, connectedCount: number \| null }`; `connectedCount` is `null` when the live count cannot be read; `401` without a matching presenter cookie; `404` NOT_FOUND; `400` bad id. Never the key or hash. Poll, prompt and question fields join in later phases |
| GET    | `/sessions/:id/participants`             | P   | Deferred to the realtime phase                                                                                                                                                                                                                                                                                                                         |
| PATCH  | `/sessions/:id/settings`                 | P   | `{ aiEnabled?, qnaOpen?, aiModeration? }` [7/9]                                                                                                                                                                                                                                                                                                        |

### Polls & votes [5]

| Method | Path                                    | Who | Notes                                                                                                                                                                                                                                                                                                   |
| ------ | --------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/polls`                   | P   | `{ question, options[2–6], showResults? }` → `201` `PresenterPoll` (DRAFT). `400` lengths, count, empty or duplicate labels (trimmed, case-insensitive); `409 SESSION_ENDED`; `409 POLL_LIMIT_REACHED` (50 per session); rate limited 60 per IP per minute                                              |
| GET    | `/sessions/:id/polls`                   | P   | `200 { polls }`: every poll in the session, drafts included, with counts and percentages                                                                                                                                                                                                                |
| POST   | `/polls/:id/start`                      | P   | DRAFT → ACTIVE. `200` `PresenterPoll`. `409 POLL_NOT_DRAFT` (already started or closed); `409 POLL_ALREADY_ACTIVE` (another poll is open); `409 SESSION_ENDED`                                                                                                                                          |
| POST   | `/polls/:id/close`                      | P   | ACTIVE → CLOSED. `200` `PresenterPoll`. Closing an already closed poll returns `200` unchanged. `409 POLL_NOT_ACTIVE` on a draft                                                                                                                                                                        |
| PATCH  | `/polls/:id`                            | P   | `{ showResults }` → `200` `PresenterPoll`. Allowed on draft, open and closed polls; the question and options stay fixed. `400` on a bad body                                                                                                                                                            |
| POST   | `/polls/:id/votes`                      | A   | Participant of the poll's session. `{ optionId }` → `201 { pollId, myOptionId }`. `400 INVALID_OPTION`; `401 PARTICIPANT_AUTH_REQUIRED`; `404` unknown or draft poll; `409 POLL_NOT_ACTIVE` (closed, including when the session ended); `409 VOTE_ALREADY_RECORDED`; rate limited 300 per IP per minute |
| GET    | `/sessions/by-code/:code/polls/current` | A   | `200 { poll }`: the open poll, else the most recently closed poll, else `null`. Never a draft. `results` is `null` while `showResults` is false                                                                                                                                                         |

Polls are HTTP only: votes are not socket commands. Every `/polls/:id` route takes the session from the poll row and
checks the presenter or participant cookie for that session, never a session id from the request. `PresenterPoll` is `{ id, question, status, showResults, closedAt, options, results }`;
`ParticipantPoll` is `{ id, question, status, showResults, closedAt, options, myOptionId, results }`;
`PollResults` is `{ total, version, options: [{ id, count, pct }] }`, where `version` is the total vote count and
`pct` is rounded to one decimal place.

### Word cloud [6]

| Method | Path                                           | Who | Notes                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ---------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/word-prompts`                   | P   | `{ question, showCloud? }` → `201` `PresenterWordPrompt` (DRAFT). `400` on the question; `409 SESSION_ENDED`; `409 PROMPT_LIMIT_REACHED` (50 per session); rate limited 60 per IP per minute                                                                                                                                                                                       |
| GET    | `/sessions/:id/word-prompts`                   | P   | `200 { prompts }`: every prompt in the session, drafts included, each with its cloud                                                                                                                                                                                                                                                                                               |
| POST   | `/word-prompts/:id/start`                      | P   | DRAFT → ACTIVE. `200` `PresenterWordPrompt`. Closes the session's open prompt first, in the same transaction. `409 PROMPT_NOT_DRAFT` (already started or closed); `409 SESSION_ENDED`                                                                                                                                                                                              |
| POST   | `/word-prompts/:id/close`                      | P   | ACTIVE → CLOSED. `200` `PresenterWordPrompt`. Closing an already closed prompt returns `200` unchanged. `409 PROMPT_NOT_ACTIVE` on a draft                                                                                                                                                                                                                                         |
| PATCH  | `/word-prompts/:id`                            | P   | `{ showCloud }` → `200` `PresenterWordPrompt`. Allowed on draft, open and closed prompts. `400` on a bad body                                                                                                                                                                                                                                                                      |
| POST   | `/word-prompts/:id/responses`                  | A   | Participant of the prompt's session (checked before the body). `{ text }` → `201 { promptId, myWord }`, no counts. `400` on field `text` (empty, or more than 30 characters); `401 PARTICIPANT_AUTH_REQUIRED`; `404` unknown or draft prompt; `409 PROMPT_NOT_ACTIVE` (closed, including when the session ended); `409 WORD_ALREADY_SUBMITTED`; rate limited 300 per IP per minute |
| GET    | `/sessions/by-code/:code/word-prompts/current` | A   | `200 { prompt }`: the open prompt, else the most recently closed one, else `null`. Never a draft. `cloud` is `null` while `showCloud` is false                                                                                                                                                                                                                                     |

Word cloud DTOs: `PresenterWordPrompt` is `{ id, question, status, showCloud, closedAt, cloud }`;
`ParticipantWordPrompt` is `{ id, question, status, showCloud, closedAt, myWord, cloud }`; `WordCloud` is
`{ total, version, entries: [{ key, word, count }] }`, at most 30 entries, ordered by count descending then `key`.
`version` is the total response count (answers are final). The cloud is computed in PostgreSQL; no separate cloud endpoint exists.

### Q&A [7]

| Method | Path                      | Who    | Notes                                                                              |
| ------ | ------------------------- | ------ | ---------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/questions` | A      | `{ text }` → `201 { question }` (status may be `PENDING_REVIEW`)                   |
| GET    | `/sessions/:id/questions` | P or A | Participants get `VISIBLE`/`ANSWERED` only; presenter gets all, filter by `status` |
| POST   | `/questions/:id/upvote`   | A      | `201`; duplicate `409`; own question `403`                                         |
| PATCH  | `/questions/:id`          | P      | `{ status?: HIDDEN                                                                 | VISIBLE | ANSWERED | REJECTED, pinned?, answerText? }` |

### Reactions [8]

Sent over socket only (`reaction:send`). `GET /sessions/:id/reactions/summary` (P or A) returns totals and a
per-minute timeline.

### AI — knowledge base [10]

| Method | Path                             | Who | Notes                                                                                        |
| ------ | -------------------------------- | --- | -------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/knowledge`        | P   | multipart `file` (PDF/MD/TXT, size + page limits) → `202 { documentId, status: PROCESSING }` |
| GET    | `/sessions/:id/knowledge`        | P   | Documents with status and chunk count                                                        |
| DELETE | `/knowledge/:documentId`         | P   | Deletes document + chunks                                                                    |
| POST   | `/sessions/:id/knowledge/search` | P   | `{ query, k? }` → chunks with scores (debug/demo of retrieval)                               |

### AI — features [11–14]

| Method | Path                                | Who | Notes                                                                                             |
| ------ | ----------------------------------- | --- | ------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/ai/poll-suggestions` | P   | `{ instruction?, count? }` → `202 { jobId }`; results via `ai:poll-suggestions-ready`             |
| GET    | `/sessions/:id/ai/poll-suggestions` | P   | Latest suggestions                                                                                |
| POST   | `/ai/poll-suggestions/:id/dismiss`  | P   |                                                                                                   |
| GET    | `/sessions/:id/ai/answer-drafts`    | P   | Pending drafts with citations                                                                     |
| POST   | `/ai/answer-drafts/:id/approve`     | P   | `{ finalText? }` → publishes answer, `200`                                                        |
| POST   | `/ai/answer-drafts/:id/reject`      | P   |                                                                                                   |
| POST   | `/questions/:id/release`            | P   | Release a held question to `VISIBLE`                                                              |
| POST   | `/sessions/:id/ai/insights/refresh` | P   | `202 { jobId }` (debounced; `200` with latest if fresh)                                           |
| GET    | `/sessions/:id/ai/insights`         | P   | Latest of each kind                                                                               |
| GET    | `/sessions/:id/ai/report`           | P   | Report (generated when session ends; `202` if still running)                                      |
| POST   | `/sessions/:id/ai/ask`              | P   | `{ question }` → streamed answer (SSE `text/event-stream`: `token`, `citations`, `done`, `error`) |
| GET    | `/sessions/:id/ai/usage`            | P   | Tokens used / budget, jobs by status                                                              |
| GET    | `/ai/jobs/:id`                      | P   | Job status (must belong to presenter's session)                                                   |

### Ops

`GET /health` (liveness) · `GET /ready`: `200 { status: 'ready', checks }` when all up; `200 { status: 'degraded', checks: { postgres: 'up', redis: 'down' } }` when only Redis is down (live updates degraded, HTTP still served); `503` when PostgreSQL is down. AI status informational.

## 3. Status codes

200 read/idempotent · 201 created · 202 accepted (async AI job) · 400 malformed · 401 missing/invalid credential ·
403 wrong role/session · 404 absent or concealed · 409 duplicate / invalid lifecycle · 413 upload too large ·
415 unsupported file type · 429 rate limited · 500 generic · 503 dependency unavailable (incl. `AI_UNAVAILABLE`).

## 4. Implementation checklist

Zod for params/query/body · DTO mappers · auth middleware per role · rate limits (join, vote, word, question,
upvote, AI endpoints) · body/upload size limits · request IDs + structured logs · Sequelize unique-violation
mapping · tests for success, 400, 401, 403, 404, 409, 429 and dependency failure.
