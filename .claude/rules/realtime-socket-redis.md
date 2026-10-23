---
paths:
  - "api/src/realtime/**"
  - "web/src/realtime/**"
  - "shared/src/events/**"
---

# Socket.IO + Redis adapter

**Contracts:** typed `ClientToServerEvents`/`ServerToClientEvents` plus a Zod schema per client payload, in
`shared/src/events/`. Names `domain:action`: intents as verbs (`poll:vote`), broadcasts as state
(`poll:results-updated`). Client events ack `{ ok: true, data } | { ok: false, error }` using the HTTP error codes.
Payload changes are breaking: update both sides together.

**Authorization:** authenticate in `io.use()`, identity on `socket.data`. `session:join` checks the user may join
before `socket.join("session:<id>")`; only verified hosts join `session:<id>:host`. Re-authorize and Zod-validate
**every** inbound event. Never broadcast data recipients may not see (who voted for what, other participants' details).

**Redis/durability:** separate pub/sub clients; log Redis errors visibly. Messages can be lost; Postgres is truth.
Emit only after commit, never inside a transaction.

**Reconnect/duplicates:** on reconnect the client re-joins and fetches an HTTP snapshot. Broadcasts carry a
per-entity `version`/sequence; clients drop stale updates. Mutations idempotent (unique constraints, client
request ids). Throttle high-frequency broadcasts like live vote counts.

**Tests:** real server on an ephemeral port + `socket.io-client`: rejected handshake, unauthorized join, invalid
payload, ack errors, room-only delivery; close all clients and the server in `afterAll`.
