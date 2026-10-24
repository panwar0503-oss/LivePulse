# 05 — Socket.IO Events

Phases 4 (realtime-backbone), 5 (live polls) and 6 (word cloud) are built. Sections 1, 2, 4 and 5 describe what the code does today. Events for later phases are listed separately in section 6.

## 1. General rules
- Event maps and payload schemas live in `shared/src/events/realtime.ts`; payloads are validated with Zod on the server.
- Identity comes from the session cookies sent with the handshake (`lp_presenter_<id>` / `lp_participant_<id>`, HttpOnly), never from the handshake payload beyond the role and session selector, and never from client events.
- Persist + commit before emitting. Redis adapter fans out across instances; PostgreSQL is durable storage.
- Redis Pub/Sub does not replay. On every connect (including reconnect) the client refetches state over HTTP (`GET /api/sessions/:id/state` for the presenter, `GET /api/sessions/by-code/:code/participant-me` for participants).
- Every server event carries the entity ID so clients can match it to the screen they show.

## 2. Connection
- Path `/api/socket.io` (not the default `/socket.io`): session cookies use `Path=/api`, so the default path would send no cookies.
- Websocket transport only. No HTTP long-polling fallback (polling across several instances would need sticky sessions).
- Origin: the handshake must carry an `Origin` header that is listed in `WEB_ORIGIN`. A missing or unlisted origin is refused.
- Handshake `auth` is a discriminated union on `role`:
  - Presenter: `{ role: 'presenter', sessionId }`. The server reads `lp_presenter_<sessionId>` and checks its hash against the session.
  - Participant: `{ role: 'participant', roomCode }`. The server looks up the session by room code and reads `lp_participant_<sessionId>`.
- Refusals arrive as `connect_error`. `err.message` is one of:
  - `FORBIDDEN_ORIGIN`: origin missing or not allowed.
  - `TOO_MANY_CONNECTIONS`: per-IP cap (`SOCKET_MAX_PER_IP`) or per-session cap (`SOCKET_MAX_PER_SESSION`, counted per instance).
  - `UNAUTHORIZED`: bad or missing cookie, unknown session, or a cookie for a different session. The response is identical in all three cases.
  - `err.data` is `{ code, message }` with the same code and a generic message.
- Client IP for the per-IP cap is `handshake.address`; the left-most `X-Forwarded-For` entry is used only when `TRUST_PROXY` is on.

## 3. Rooms
- Rooms are joined during the handshake, before `connect` fires. There is no `session:join` event.
- `session:<sessionId>`: every authorised socket for the session (presenter and participants).
- `presenter:<sessionId>`: presenter sockets only.
- Rooms are derived only from the verified cookie. Clients never send room names.
- Because the join happens before `connect`, a client that refetches on `connect` cannot miss an event sent in between.

## 4. Client → server

No client → server events exist yet. Any client event is ignored by the server.

Votes are HTTP, not socket commands: `POST /api/polls/:id/votes` reuses cookie auth, rate limits and the error envelope.
Word submissions are HTTP too: `POST /api/word-prompts/:id/responses`.

Later phases add commands (`question:submit`, `question:upvote`, `reaction:send`). They are not built yet and are listed in section 6.

Ack convention for those later commands: `{ success: true, data }` or `{ success: false, error: { code, message } }`, using the HTTP error codes. This is the decided shape; no command event uses it yet.

## 5. Server → client

| Event | Room | Payload | Notes |
|---|---|---|---|
| `presence:count` | `presenter:<id>` | `{ sessionId, connected, countedAt }` | Presenter only. Participants never receive the audience count. |
| `session:ended` | `session:<id>` | `{ sessionId, endedAt }` | `endedAt` is ISO 8601. Emitted after the end commits. |
| `session:error` | one socket, or all local sockets | `{ code, message }` | `code`: `SERVER_RESTARTING`, `REALTIME_DEGRADED` or `REALTIME_RESTORED`. |
| `poll:started` | session | `{ poll: { id, question, options: [{ id, label, position }], showResults } }` | Sent after the start commits. No counts. |
| `poll:closed` | session | `{ pollId, closedAt }` | Sent after the close commits, and when ending the session closes an open poll. |
| `poll:updated` | session | `{ pollId, showResults }` | Sent only when the switch changes. Clients refetch. |
| `poll:results` | presenter room when `showResults` is false, session room when true | `{ pollId, total, version, options: [{ id, count, pct }] }` | Counts for one poll. `version` is the total vote count; clients drop any update not newer. |
| `wordcloud:started` | session | `{ prompt: { id, question, showCloud } }` | Sent after the start commits. No words or counts. |
| `wordcloud:closed` | session | `{ promptId, closedAt }` | Sent after the close commits, and when starting another prompt or ending the session closes the open one. |
| `wordcloud:updated` | session | `{ promptId, showCloud }` | Sent only when the switch changes. Clients refetch. |
| `wordcloud:results` | presenter room when `showCloud` is false, session room when true | `{ promptId, total, version, entries: [{ key, word, count }] }` | Cloud for one prompt. `version` is the total response count; clients drop any update not newer. |

Poll rules:
- Participants never receive `poll:results` while results are hidden: the room is chosen from a fresh database read at send time, and participants are not in the presenter room.
- Vote-count updates are combined per poll (about 250 ms). Each send reads counts and `showResults` fresh from PostgreSQL.
- Closing a poll (or ending the session with one open) sends `poll:results` first, then `poll:closed`. Changing the switch sends `poll:updated`, then `poll:results` with the current counts.
- Clients refetch the poll over HTTP on `poll:started`, `poll:closed`, `poll:updated`, and on every connect. Only `poll:results` is applied directly.
- No voter identity appears in any poll payload.

Word cloud rules:
- Participants never receive `wordcloud:results` while the cloud is hidden: the room is chosen from a fresh database read at send time.
- Submissions are combined per prompt (about 250 ms). Each send reads the cloud and `showCloud` fresh from PostgreSQL.
- Closing a prompt (or ending the session with one open) sends `wordcloud:results` first, then `wordcloud:closed`. Starting a prompt while another is open closes the old one the same way, then sends `wordcloud:started`. Changing the switch sends `wordcloud:updated`, then `wordcloud:results` with the current cloud.
- Clients refetch the prompt over HTTP on `wordcloud:started`, `wordcloud:closed`, `wordcloud:updated`, and on every connect. Only `wordcloud:results` is applied directly.
- No participant identity appears in any word-cloud payload.

Presence rules:
- The count is the number of distinct participants (`participantId`) connected to the session across every instance. Two tabs from one participant count once.
- The presenter is never counted, including when the presenter has several devices open.
- The count is taken from the shared adapter (`fetchSockets` on the session room), so no counter is stored and a crashed instance's sockets drop out on their own.
- A participant connecting triggers a recount soon (coalesced to about 250 ms per session).
- A participant disconnecting triggers a recount after `PRESENCE_GRACE_MS` (default 5000). A refresh that reconnects within the grace period does not lower the count.
- Each `presence:count` carries `countedAt`; clients drop counts that are older than the one they have.
- If the count cannot be taken (request timeout 2000 ms, or an instance does not answer), nothing is emitted. `GET /api/sessions/:id/state` returns `connectedCount: null` and the UI shows "—".

Redis outage:
- Sockets are kept. Each instance sends `session:error { code: 'REALTIME_DEGRADED' }` to its local sockets when the shared channel goes down, and `REALTIME_RESTORED` when it comes back.
- Redis does not replay broadcasts missed during the outage, so the client refetches state on restore.
- `GET /ready` returns 200 with `status: 'degraded'` while Redis is down (see docs/04).
- Publish failures are logged and never crash the process. The adapter publishes without a catch, so the pub client's `publish` is wrapped to log failures.

Shutdown:
- Pending presence timers are cleared, then each local socket gets `session:error { code: 'SERVER_RESTARTING' }`. Clients reconnect with backoff and refetch state.
- Sockets and the HTTP server are closed by `io.close()`, then Redis and Sequelize are closed. The whole sequence is bounded by a 10 s limit.

Client reconnect:
- The client refetches state over HTTP on every `connect`, including the first.
- A server-initiated disconnect (restart) is reconnected by the client with backoff.
- After a session has ended, the snapshot shows the ended state and no further events are sent for it.

## 6. Later phases (not built)

These events are planned and do not exist in the code yet. They are listed for reference only.

Client → server (commands): `question:submit` (7), `question:upvote` (7), `reaction:send` (8).

Server → client:

| Event | Room | Payload | Phase |
|---|---|---|---|
| `question:created` | session (VISIBLE) / presenter (PENDING_REVIEW) | `{ question }` | 7 |
| `question:updated` | session / presenter | `{ questionId, upvoteCount?, status?, pinned?, version }` | 7 |
| `question:answered` | session | `{ questionId, answerText, aiAssisted, answeredAt }` | 7/12 |
| `reaction:burst` | session | `{ counts: { "👍": 3, … }, windowMs }` (throttled ~500 ms) | 8 |
| `ai:knowledge-updated` | presenter | `{ documentId, status, chunkCount }` | 10 |
| `ai:poll-suggestions-ready` | presenter | `{ jobId, suggestions[] }` | 11 |
| `ai:answer-draft-ready` | presenter | `{ questionId, draft: { id, text, citations, grounded } }` | 12 |
| `ai:question-flagged` | presenter | `{ questionId, label, reason }` | 12 |
| `ai:question-merged` | presenter + asker | `{ questionId, duplicateOfId }` | 12 |
| `ai:insights-updated` | presenter | `{ kind, payload, version }` | 13 |
| `ai:report-ready` | presenter | `{ sessionId }` | 14 |
| `ai:job-failed` | presenter | `{ jobId, type, code, message }` | 9 |
| `ai:usage` | presenter | `{ tokensUsed, budget }` | 9 |

Participants never receive AI drafts, held questions, moderation labels, or other participants' tokens.

## 7. Ordering and idempotency
- Ack = validated and durably committed.
- No exactly-once assumption; duplicates handled via DB constraints and client-side version checks.
- If commit succeeds but broadcast fails, the next state fetch repairs the UI.
- `requestId` helps dedupe transport retries; the DB unique constraint is still the real guard.

## 8. Reactions fan-out
Reactions are high-frequency. The server validates and rate-limits each `reaction:send`, adds it to an in-memory
per-session counter, and every ~500 ms emits one `reaction:burst` and flushes the counts into `reaction_counts`
(upsert). Across instances each instance flushes its own counts; totals are read from PostgreSQL.

## 9. Redis adapter requirements
Compatible `socket.io` / `redis` / `@socket.io/redis-adapter` versions · separate pub/sub clients awaited at
startup · adapter attached before listening · error handling + graceful shutdown · two-instance integration test ·
never publish secrets or tokens.

## 10. Environment
- `PRESENCE_GRACE_MS`: grace before a disconnect lowers the count. Default 5000, range 0–60000.
- `SOCKET_MAX_PER_IP`: open sockets per client address. Default 20.
- `SOCKET_MAX_PER_SESSION`: sockets per session on one instance. Default 500.
