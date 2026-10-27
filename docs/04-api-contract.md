# 04 — REST API Contract

## 1. Conventions

- Base path `/api`. JSON in/out except knowledge document upload (raw file bytes, see below).
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
| POST   | `/sessions/:id/end`                      | P   | Ending is final; repeat call returns `200` with the same `endedAt`. Also closes Q&A in the same commit                                                                                                                                                                                                                                                 |
| GET    | `/sessions/:id/state`                    | P   | Presenter snapshot for (re)connect: `200 { id, title, roomCode, status, endedAt, joinedCount, connectedCount: number \| null }`; `connectedCount` is `null` when the live count cannot be read; `401` without a matching presenter cookie; `404` NOT_FOUND; `400` bad id. Never the key or hash. Poll, prompt and question fields join in later phases |
| GET    | `/sessions/:id/participants`             | P   | Deferred to the realtime phase                                                                                                                                                                                                                                                                                                                         |
| PATCH  | `/sessions/:id/settings`                 | P   | `{ qnaOpen }` [7] (see Q&A below); `aiEnabled`, `aiModeration` [9]                                                                                                                                                                                                                                                                                     |

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

| Method | Path                                | Who | Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/by-code/:code/questions` | A   | Participant cookie checked before the body. `{ text }` → `201 { question }`. `400` on field `text` (empty, over 200 characters, control characters); `401 PARTICIPANT_AUTH_REQUIRED`; `404` unknown code; `409 SESSION_ENDED`, `QNA_CLOSED`, `QUESTION_LIMIT_REACHED` (5 per participant per session), `QUESTION_ALREADY_ASKED` (same text again, after normalisation); rate limited 120 per IP per minute |
| GET    | `/sessions/by-code/:code/questions` | A   | `200 { qnaOpen, questions }`: visible questions only, in server order. `401 PARTICIPANT_AUTH_REQUIRED`; `404` unknown code                                                                                                                                                                                                                                                                                 |
| GET    | `/sessions/:id/questions`           | P   | `200 { qnaOpen, questions }`: every question, hidden ones included (`hidden` flag). `401 PRESENTER_AUTH_REQUIRED`; `404` NOT_FOUND                                                                                                                                                                                                                                                                         |
| POST   | `/questions/:id/upvotes`            | A   | No body. Participant of the question's session, cookie checked after the question is loaded. `201 { questionId, myUpvote: true }`. `404` unknown, hidden or missing question; `401 PARTICIPANT_AUTH_REQUIRED` (no cookie, or a cookie of another session); `403 OWN_QUESTION`; `409 SESSION_ENDED`, `QNA_CLOSED`, `UPVOTE_ALREADY_RECORDED`; rate limited 300 per IP per minute                            |
| PATCH  | `/questions/:id`                    | P   | `{ hidden?, pinned?, answered?, answerText? }`, at least one field → `200 PresenterQuestion`. `answerText: null` clears the answer text. Allowed after the session has ended. `400` on field names or an empty body; `401 PRESENTER_AUTH_REQUIRED`; `404` NOT_FOUND; `409 QUESTION_HIDDEN` (pinning a hidden question); `409 QUESTION_PIN_CONFLICT` (another pin committed at the same time)               |
| PATCH  | `/sessions/:id/settings`            | P   | `{ qnaOpen }` (no other keys) → `200 { qnaOpen }`. Closing an ended session returns `200` unchanged; opening one → `409 SESSION_ENDED`. Emits `qna:status` only when the value changes. `400`; `401 PRESENTER_AUTH_REQUIRED`; `404` NOT_FOUND                                                                                                                                                              |

- DTOs: `PublicQuestion` = `{ id, text, upvotes, pinned, answered, answerText, answeredAt, createdAt }`;
  `ParticipantQuestion` = `PublicQuestion` + `{ mine, myUpvote }`; `PresenterQuestion` = `PublicQuestion` + `{ hidden }`.
- Order (every screen): pinned first, then upvotes (most first), then `createdAt` (oldest first), then `id`.
- No participant id, name or voter appears in any Q&A response. `text` and `answerText` are plain text.
- Every `/questions/:id` route takes the session from the question row, never from the request.

### Reactions [8]

Sent over socket only (`reaction:send`). `GET /sessions/:id/reactions/summary` (P or A) returns totals and a
per-minute timeline.

### AI foundation (built)

Paths are under `/api`. Requirement: `requirements/ai-foundation/`. Responses never include job input, output or prompts.

| Method | Path                               | Who | Body                 | Success                                                                                                 | Errors                                                                                              |
| ------ | ---------------------------------- | --- | -------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/sessions/:id/ai`                 | P   | –                    | `200 { enabled, globalEnabled, provider, usage: { tokensUsed, tokenBudget }, recentFailures }` (last 5) | 401, 404                                                                                            |
| PATCH  | `/sessions/:id/ai`                 | P   | strict `{ enabled }` | `200 { enabled, cancelledJobs }`                                                                        | 400, 409 `SESSION_ENDED`, 503 `AI_DISABLED`                                                         |
| POST   | `/sessions/:id/ai/jobs/diagnostic` | P   | none                 | `202 { jobId, status, created }` (dedupe key `diagnostic`)                                              | 409 `AI_OFF_FOR_SESSION` / `SESSION_ENDED` / `AI_BUDGET_EXHAUSTED`, 503 `AI_DISABLED`, 429 (10/min) |
| GET    | `/sessions/:id/ai/jobs/:jobId`     | P   | –                    | `200` job summary (never input or output)                                                               | 401, 404 (also when the job belongs to another session)                                             |
| PATCH  | `/ops/ai`                          | Op  | strict `{ enabled }` | `200 { enabled }`                                                                                       | 401 (missing or wrong `X-Operator-Key`), 400; 503 when `OPERATOR_KEY` is unset                      |

Op = operator, authenticated by the `X-Operator-Key` header (value from `OPERATOR_KEY`, never logged). Turning it off
cancels every pending AI job. Rate limit on this route: 10/min. Live updates for these changes: `ai:status`, `ai:usage`
and `ai:job-failed` (presenter room only, see `05-realtime-events.md`).

### Knowledge base [10] (built)

Presenter only. Requirement: `requirements/knowledge-base-rag/`. Responses never include file bytes, content hashes or
embeddings. Every route checks the presenter cookie for the path's session (401 without it; 404 for a missing or another
presenter's session).

| Method | Path                                       | Who | Body                                            | Success                                             | Errors                                                                                                                                                                                                               |
| ------ | ------------------------------------------ | --- | ----------------------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/knowledge/documents`        | P   | Raw file bytes; header `X-File-Name` (required) | `201` `KnowledgeDocument` with `status: PROCESSING` | 400 `INVALID_FILE_NAME`, `EMPTY_FILE`; 409 `DUPLICATE_DOCUMENT`, `DOCUMENT_LIMIT_REACHED`, `SESSION_ENDED`, `AI_OFF_FOR_SESSION`; 413 `FILE_TOO_LARGE`; 415 `UNSUPPORTED_FILE_TYPE`; 429 (10/min); 503 `AI_DISABLED` |
| GET    | `/sessions/:id/knowledge/documents`        | P   | –                                               | `200 { documents }` (at most 20, oldest first)      | 401, 404                                                                                                                                                                                                             |
| DELETE | `/sessions/:id/knowledge/documents/:docId` | P   | –                                               | `204`                                               | 401, 404                                                                                                                                                                                                             |
| POST   | `/sessions/:id/knowledge/search`           | P   | `{ query }`, 1–500 characters (30/min)          | `200 { results, reranked }`                         | 400, 401, 404, 503 `KNOWLEDGE_UNAVAILABLE`                                                                                                                                                                           |

- **Upload:** the body is the raw file, not multipart. `express.raw` with a 10 MB limit applies to this route only. The
  checks run in this order: presenter cookie, rate limit, Content-Length (413 before buffering), file name, then content.
  The name must be a plain name ending in `.pdf` or `.txt` (case-insensitive). The browser percent-encodes the name with
  `encodeURIComponent` because header values are Latin-1 only; the server decodes it, and a bad encoding returns 400
  `INVALID_FILE_NAME`.
- **Upload result:** the document is `PROCESSING` when the response is sent. Processing runs in the background; its
  outcome arrives as `knowledge:document-status` and in the next list.
- **`KnowledgeDocument`:** `{ id, fileName, mimeType, sizeBytes, status, failureReason, pageCount, passageCount, createdAt }`.
  `status` is `PROCESSING`, `READY` or `FAILED`. `failureReason` is `null` unless `FAILED`: `NO_TEXT`, `UNREADABLE`,
  `TOO_MANY_PAGES`, `TOO_LARGE_TEXT`, `TIMEOUT` or `PROCESSING_STOPPED`.
- **Search result:** each result has the passage text, its document name and location (page number for PDF, section number
  for text) and a score. Results are in rank order. No relevant passage gives `200` with an empty `results` list, never an
  invented one. `reranked` is `false` when the reranker was unavailable and the fused order was returned.

### Poll suggestions [11] (built)

Presenter only. Requirement: `requirements/ai-poll-generator/`. The POST route checks the origin and the presenter cookie
for the path's session; a missing cookie or a participant's cookie gets 401, and a missing or another presenter's session
gets 404. Suggestions are drafts for the presenter only: they are not polls and never reach participants. Passage text
appears only in these responses.

| Method | Path                                    | Who | Body          | Success                          | Errors                                                                                                                                              |
| ------ | --------------------------------------- | --- | ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/sessions/:id/poll-suggestions`        | P   | `{}` (strict) | `202 { jobId, status, created }` | 400, 401, 404, 409 `AI_OFF_FOR_SESSION`, `AI_BUDGET_EXHAUSTED`, `SESSION_ENDED`, `NO_RELEVANT_PASSAGES`; 429 (6/min per session); 503 `AI_DISABLED` |
| GET    | `/sessions/:id/poll-suggestions/latest` | P   | –             | `200` DTO, or `null` if none     | 401, 404                                                                                                                                            |
| GET    | `/sessions/:id/poll-suggestions/:jobId` | P   | –             | `200` DTO                        | 401, 404 (missing, another session, or not a `SUGGEST_POLLS` job)                                                                                   |

- **Request:** `created` is `true` for a new job. A repeat request within 30 seconds of a finished job, or while one is
  in flight, returns that job with `created: false`. No second job is queued. A session with no READY passage gets 409
  `NO_RELEVANT_PASSAGES` before any job exists.
- **DTO:** `{ jobId, status, errorCode, message, outcome, suggestions }`. `outcome` is `PENDING`, `READY`, `NONE` or
  `FAILED`. `suggestions` is a list of `{ index, question, options, source: { documentName, location, text } }`, with
  2 to 4 options each and at most 3 items. `source` is taken from READY passages at read time, so a suggestion whose
  document was deleted is no longer returned.
- **Latest:** returns the DTO of the newest request, or `null`. It returns `null` once the session has ended.
- Model output is checked against a strict schema; malformed items are dropped and never returned.

### AI Q&A copilot [12] (built)

Presenter only. Requirement: `requirements/ai-qna-copilot/`. Every route checks the origin (403 `FORBIDDEN_ORIGIN`)
and the presenter cookie for the path's session (401 `PRESENTER_AUTH_REQUIRED` without it). Every draft and question is
looked up by id and session, so another session's row gets 404 `NOT_FOUND`. The four mutations share a rate limit of
60 per minute per session (429 `RATE_LIMITED`). Moderation labels and drafts appear in these presenter responses only. Draft text is never sent over a socket.

| Method | Path                                              | Who | Body                          | Success                                                         | Errors                                                                                                              |
| ------ | ------------------------------------------------- | --- | ----------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GET    | `/sessions/:id/qna/review`                        | P   | –                             | `200 { held, drafts }`                                          | 401, 404                                                                                                            |
| POST   | `/sessions/:id/qna/drafts/:draftId/approve`       | P   | `{ text? }` (strict, max 500) | `200` `PresenterQuestion` (the question now carries the answer) | 400 `VALIDATION_ERROR`, 401, 404, 409 `DRAFT_NOT_PENDING`, `QUESTION_NOT_VISIBLE`, `QUESTION_ALREADY_ANSWERED`, 429 |
| POST   | `/sessions/:id/qna/drafts/:draftId/reject`        | P   | none (or `{}`)                | `200 { ok: true }`                                              | 400, 401, 404, 409 `DRAFT_NOT_PENDING`, 429                                                                         |
| POST   | `/sessions/:id/qna/questions/:questionId/release` | P   | none (or `{}`)                | `200` `PresenterQuestion` (now `VISIBLE`)                       | 400, 401, 404, 409 `QUESTION_NOT_HELD`, 429                                                                         |
| POST   | `/sessions/:id/qna/questions/:questionId/reject`  | P   | none (or `{}`)                | `200 { ok: true }` (question `REJECTED`)                        | 400, 401, 404, 409 `QUESTION_NOT_HELD`, 429                                                                         |
| GET    | `/sessions/:id/qna/clusters`                      | P   | –                             | `200 { clusters }`                                              | 401, 404                                                                                                            |

- **Review:** `held` lists the session's HELD questions (`questionId`, `text`, `label`, `createdAt`). `label` is `null`
  when the question was never classified (held by the session end). `drafts` lists only DRAFTING and PENDING_REVIEW
  drafts, each with `id`, `questionId`, `questionText`, `status`, `outcome` (`GROUNDED` or `NOT_COVERED`), `text`,
  `language`, `confidence` and `citations`. Citations carry the document name and location; `quote` is always `null`.
- **Approve:** the draft must be PENDING_REVIEW, its question VISIBLE and unanswered. `text` is optional; without it the
  draft's own text is published. The approved text becomes the question's answer, exactly once. Drafts still DRAFTING
  cannot be approved (409 `DRAFT_NOT_PENDING`).
- **Reject draft:** the draft becomes REJECTED. The question stays VISIBLE and unanswered.
- **Release and reject question:** only for HELD questions. Release makes the question VISIBLE and creates no draft
  (the presenter answers by hand). Reject makes it REJECTED.
- **Clusters:** `{ clusters: [{ id, label, size, questionIds }] }`, from VISIBLE questions only, largest first. The list
  is empty until there are at least 3 clustered questions. `label` is the text of the earliest question in the cluster.

### Session report and chat [14] (built)

Presenter only. Requirement: `requirements/ai-session-report/`. Every route checks the presenter cookie for the path's session (401 without it; 404 for a missing or another presenter's session). The POST route also checks the origin (403 `FORBIDDEN_ORIGIN`). The report has no table: it is computed from the session's data on each read. The report works with AI off; the chat needs AI on.

| Method | Path                          | Who | Body                                                               | Success                                                                                                                          | Errors                                                                                                                                                                              |
| ------ | ----------------------------- | --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/sessions/:id/report`        | P   | –                                                                  | `200` `SessionReport`: poll results, top word-cloud terms, question counts, top-upvoted questions, knowledge documents, AI usage | 401, 404                                                                                                                                                                            |
| GET    | `/sessions/:id/report/export` | P   | –                                                                  | `200` JSON attachment with the same `SessionReport` DTO                                                                          | 401, 404                                                                                                                                                                            |
| GET    | `/sessions/:id/report/chat`   | P   | –                                                                  | `200 { turns }`: this session's chat history                                                                                     | 401, 404                                                                                                                                                                            |
| POST   | `/sessions/:id/report/chat`   | P   | strict `{ clientMessageId` (uuid), `question` (1–500 characters) } | `200` `text/event-stream` (SSE), see below                                                                                       | Refused as JSON before the stream: 400; 401; 403 `FORBIDDEN_ORIGIN`; 404; 409 `AI_OFF_FOR_SESSION`, `AI_BUDGET_EXHAUSTED`, `CHAT_BUSY`, `DUPLICATE_MESSAGE`; 429; 503 `AI_DISABLED` |

- **Stream:** events are `start`, `delta` (text), `tool` (tool name only), `done` (sources) and `error` (fixed text, no provider detail). Once the stream has started the HTTP status is already 200, so a later failure is an `error` event and the stored answer is `INCOMPLETE`. Responses are not compressed and carry `X-Accel-Buffering: no`. Closing the connection aborts the model call.
- **Sources:** the server sets them from tool results. Citations written by the model are ignored. `done` carries the sources for that answer.
- **Chat turns:** each turn has the question, the answer, a `status` (`INCOMPLETE` when cut short), an error code when set, and its sources.
- **Limits:** one streaming answer per session at a time (`CHAT_BUSY`); each question reserves tokens from the session AI budget.
- **Privacy:** the report, the export and the chat carry no participant identifiers or display names.

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

### AI actions — MCP proposals [15] (built)

Presenter cookie on `:id`. Mounted only when AI is enabled. Common errors: 401 `PRESENTER_AUTH_REQUIRED`; 403
`FORBIDDEN_ORIGIN` (foreign Origin).

| Method | Path                                         | Who | Notes                                                                                                                                                                                                              |
| ------ | -------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/sessions/:id/ai/actions`                   | P   | Body `{ type, ... }`: `CREATE_POLL` (poll body), `START_POLL` / `CLOSE_POLL` `{ pollId }`, `PUBLISH_ANSWER` `{ questionId, text }`. `201 AiActionDto` (`PROPOSED`). 400, 404, 409 `SESSION_ENDED` / `AI_OFF_FOR_SESSION` / `PROPOSAL_LIMIT_REACHED`, 429, 503 `AI_DISABLED`. Used by MCP. |
| GET    | `/sessions/:id/ai/actions`                   | P   | `200 { actions }`, newest first, max 50. 404.                                                                                                                                                                      |
| POST   | `/sessions/:id/ai/actions/:actionId/approve` | P   | Web only. `200 { action }`: `EXECUTED` or `FAILED` with `errorCode` (a failed run is not an HTTP error). 404, 409 `ACTION_NOT_PROPOSED` / `SESSION_ENDED` / `AI_OFF_FOR_SESSION`, 429, 503.                            |
| POST   | `/sessions/:id/ai/actions/:actionId/reject`  | P   | Web only. `200 { action }` with `REJECTED`. 404, 409 `ACTION_NOT_PROPOSED`, 429.                                                                                                                                   |

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
