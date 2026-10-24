# 05 — Socket.IO Events

## 1. General rules
- Event maps typed in `shared/src/events/`; payloads validated with Zod on the server.
- Commands use acks: `{ success: true, data }` or `{ success: false, error: { code, message } }`.
- Identity comes from the handshake (`auth: { participantToken }` or `{ presenterKey }`), never from payloads.
- Persist + commit before emitting. Redis adapter fans out across instances; PostgreSQL is durable storage.
- Every server event carries the entity ID and a `version` or `updatedAt` so clients can drop stale updates.
- On reconnect the client re-authenticates and fetches `GET /sessions/:id/state` (Redis does not replay).

## 2. Rooms
- `session:<sessionId>` — all authorized members.
- `presenter:<sessionId>` — presenter sockets only (held questions, AI drafts, AI suggestions, usage).
- Server derives rooms from validated credentials; clients never send room names.

## 3. Client → server

| Event | Who | Payload | Phase |
|---|---|---|---|
| `session:join` | P / A | `{ sessionId }` (credential from handshake) → ack with snapshot version | 4 |
| `vote:submit` | A | `{ pollId, optionId, requestId }` | 5 |
| `word:submit` | A | `{ promptId, text, requestId }` | 6 |
| `question:submit` | A | `{ text, requestId }` | 7 |
| `question:upvote` | A | `{ questionId }` | 7 |
| `reaction:send` | A | `{ emoji }` (must be in the shared emoji set) | 8 |

Presenter commands (polls, prompts, Q&A moderation, AI approvals) go through REST for clearer auth and testing.

## 4. Server → client

| Event | Room | Payload | Phase |
|---|---|---|---|
| `presence:count` | session | `{ sessionId, connected }` (ephemeral) | 4 |
| `session:ended` | session | `{ sessionId, endedAt }` | 4 |
| `poll:started` | session | `{ poll: { id, question, options[] } }` | 5 |
| `poll:results` | session or presenter | `{ pollId, total, options: [{ id, count, pct }], version }` | 5 |
| `poll:closed` | session | `{ pollId, closedAt }` | 5 |
| `wordcloud:updated` | session | `{ promptId, items: [{ word, count }], version }` | 6 |
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
| `session:error` | socket | `{ code, message }` | 4 |

Participants never receive AI drafts, held questions, moderation labels, or other participants' tokens.

## 5. Ordering and idempotency
- Ack = validated and durably committed.
- No exactly-once assumption; duplicates handled via DB constraints and client-side version checks.
- If commit succeeds but broadcast fails, the next state fetch repairs the UI.
- `requestId` helps dedupe transport retries; the DB unique constraint is still the real guard.

## 6. Reactions fan-out
Reactions are high-frequency. The server validates and rate-limits each `reaction:send`, adds it to an in-memory
per-session counter, and every ~500 ms emits one `reaction:burst` and flushes the counts into `reaction_counts`
(upsert). Across instances each instance flushes its own counts; totals are read from PostgreSQL.

## 7. Redis adapter requirements
Compatible `socket.io` / `redis` / `@socket.io/redis-adapter` versions · separate pub/sub clients awaited at
startup · adapter attached before listening · error handling + graceful shutdown · two-instance integration test ·
never publish secrets or tokens.
