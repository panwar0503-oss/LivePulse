# realtime-backbone — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Live connection backbone

### Architecture
```
DB:        no change (no migration). Postgres stays the source of truth for status, endedAt and the joined count.
API:       GET /api/sessions/:id/state (presenter cookie) → sessions.service + realtime.countConnected
           POST /api/sessions/:id/end (existing) → after commit → realtime.emitSessionEnded
Realtime:  Socket.IO on the same HTTP server, path /api/socket.io, websocket transport only,
           Redis adapter (pub/sub = command client .duplicate())
           handshake io.use: origin → per-IP / per-session cap → Zod auth → cookie check → join rooms
           rooms: session:<id> (everyone), presenter:<id> (presenter sockets only)
           presence:count → presenter:<id> · session:ended → session:<id> · session:error → one socket or local sockets
Web:       src/realtime/use-session-socket.ts (one socket per page) → PresenterDashboard / ParticipantClient
```

### Key decisions
1. **Presence comes from the shared adapter; nothing is stored.** Count = `io.in('session:<id>').fetchSockets()` (asks
   every instance through Redis), then distinct `socket.data.participantId` among participant sockets. Two instances
   count correctly; no counters can drift; a crashed instance's sockets disappear from the count by themselves.
   Request timeout 2000 ms; on failure nothing is emitted and `/state` returns `connectedCount: null`.
2. **Grace period enforced on the server.** A participant connecting triggers an immediate recount (coalesced ~250 ms per
   session). A participant disconnecting schedules a recount after `PRESENCE_GRACE_MS` (default 5000; injectable,
   ~200 in tests). Recounts are full counts, so a refresh that finishes within the grace period never lowers the number.
   Known gap (documented): a connect during someone else's grace window can briefly show one fewer. Payloads carry
   `countedAt` so the client drops out-of-order counts.
3. **Socket path `/api/socket.io`.** Load-bearing: existing cookies use `Path=/api`, so the default `/socket.io` path
   would send no cookies.
4. **Websocket-only transport.** Polling across two instances needs sticky sessions (out of scope). Trade-off: no
   fallback on networks that block websockets. **Open question 2.**
5. **Rooms joined at handshake.** No `session:join` event. Rooms are joined in middleware before CONNECT, so the client's
   refetch on `connect` happens after the join and no event can be missed between them. Differs from docs/05 (update docs).
6. **Role selection.** Presenter: `auth: { role: 'presenter', sessionId }` and the server reads `lp_presenter_<id>`.
   Participant: `auth: { role: 'participant', roomCode }`; the server looks up the id and reads `lp_participant_<id>`.
7. **Participant snapshot reuses `GET /api/sessions/by-code/:code/participant-me`** (status, title, roomCode). Counts are
   presenter-only, so no new participant endpoint.
8. **Redis outage:** `/ready` returns 200 `status: 'degraded'` with `redis: 'down'`. Postgres down still returns 503.
   Sockets are never dropped. Pub client uses `disableOfflineQueue`. Emit failures are caught and logged. Startup still
   fails fast when Redis is unreachable.
9. **Emitting never fails an HTTP request.** `emitSessionEnded` runs after `endSession` commits, in try/catch; safe to repeat.
10. **Shutdown order:** clear grace timers → local `session:error {code:'SERVER_RESTARTING'}` → `io.close()` → close
    Sequelize and the command, pub and sub Redis clients, within the existing 10 s limit.

### Contracts
| Event | Direction | Room | Payload | Ack |
|---|---|---|---|---|
| `presence:count` | S→C | `presenter:<id>` (docs/05 said session; narrowed) | `{ sessionId, connected: number, countedAt: number }` | – |
| `session:ended` | S→C | `session:<id>` | `{ sessionId, endedAt: ISO }` | – |
| `session:error` | S→C | one socket, or all local sockets | `{ code: 'SERVER_RESTARTING' \| 'REALTIME_DEGRADED' \| 'REALTIME_RESTORED', message }` | – |
| handshake refused | `connect_error` | – | `err.message='UNAUTHORIZED'`, `err.data={code, message:'Could not connect to this session.'}` — identical for unknown session, bad cookie, wrong session. Origin / cap refusals: `FORBIDDEN_ORIGIN` / `TOO_MANY_CONNECTIONS` | – |

No client→server events in this phase. Handshake auth is a Zod discriminated union on `role`.

HTTP: `GET /api/sessions/:id/state` (presenter cookie). 200 `{ id, title, roomCode, status, endedAt, joinedCount,
connectedCount: number | null }`; 401 `PRESENTER_AUTH_REQUIRED`; 404 `NOT_FOUND`; 400 bad id. Never the key or hash.

### Files
| File | C/M | Purpose | Risk |
|---|---|---|---|
| shared/src/events/realtime.ts | C | event maps, payload schemas, handshake auth schema, error codes | MEDIUM |
| shared/src/schemas/sessions.ts | M | `presenterSessionStateSchema` | LOW |
| shared/src/schemas/api.ts | M | ready status `'ready' \| 'degraded'` | MEDIUM |
| shared/src/index.ts | M | exports | LOW |
| api/src/lib/cookies.ts | M | move cookie-name helpers here from the controller | LOW |
| api/src/db/redis.ts | M | pub/sub duplicates, connect/disconnect all three, degraded/restored callbacks | HIGH |
| api/src/services/readiness.service.ts, routes/health.routes.ts | M | degraded = 200 | MEDIUM |
| api/src/realtime/socket-auth.ts | C | origin, caps, cookie auth, room join | HIGH |
| api/src/realtime/presence.ts | C | `countConnected`, recount scheduling, grace timers | HIGH |
| api/src/realtime/index.ts | C | `createRealtime({httpServer, …})` → `{ emitSessionEnded, countConnected, close }`, adapter wiring | HIGH |
| api/src/config/env.ts | M | optional `PRESENCE_GRACE_MS`, `SOCKET_MAX_PER_IP` (20), `SOCKET_MAX_PER_SESSION` (500 per instance) | LOW |
| api/src/app.ts, controllers/sessions.controller.ts, routes/sessions.routes.ts | M | `realtime` dep, `/state`, emit after end | MEDIUM |
| api/src/server.ts | M | `createServer` → realtime → app → listen; shutdown | HIGH |
| api/tests/helpers/test-app.ts, realtime-harness.ts | M/C | noop realtime; N servers on ephemeral ports with a unique adapter key | MEDIUM |
| api/vitest.integration.config.ts | M | include `tests/realtime/**` | LOW |
| api/tests/realtime/*.test.ts | C | auth, isolation, presence, ended, two-instance, outage, shutdown, secrecy | MEDIUM |
| web/src/realtime/socket.ts, use-session-socket.ts | C | client factory and hook (status, count, ended, degraded, refetch on connect) | HIGH |
| web/src/lib/api/sessions.ts | M | `getPresenterState` | LOW |
| web/src/app/presenter/[sessionId]/page.tsx, PresenterDashboard.tsx | M | live count, Reconnecting…, degraded banner, ended | MEDIUM |
| web/src/app/session/[roomCode]/ParticipantClient.tsx, ParticipantView.tsx | M | ended, Reconnecting…, refetch | MEDIUM |
| docs/05-realtime-events.md, docs/02-architecture.md | M | cookie auth, handshake join, presence room, degraded policy, websocket-only | LOW |

### Impact analysis
- **Breaking changes:** `/ready` with Redis down changes 503 → 200 degraded (schema and health/readiness tests change).
  `createApp` gains a `realtime` dependency (test-app gets a noop). Cookie-name helpers move.
- **Migrations / rollback:** none; rollback = revert code.
- **Concurrency:** recounts are idempotent full counts ordered by `countedAt`; grace timers cleared on shutdown and
  `unref()`; `session:ended` only after commit; reconnect order join → `connect` → HTTP refetch; join-vs-end already
  serialised by FOR SHARE / FOR UPDATE.
- **Security:** origin must be present and in `WEB_ORIGIN` at handshake (stricter than HTTP — cross-site websocket
  hijacking); explicit origins with credentials; rooms derived only from the verified cookie; refusals reveal nothing;
  per-IP cap uses `handshake.address` (X-Forwarded-For only with `TRUST_PROXY`) plus per-session cap; payloads hold ids,
  counts and timestamps only (tested over every event type); unknown client events ignored; Redis errors logged without URL.
- **Testing:** real server on an ephemeral port, real Redis and test Postgres, `socket.io-client` with
  `extraHeaders: { origin, cookie }`; waits on event promises, no sleeps; two instances share one Redis with a unique key;
  all servers, clients, Redis and Sequelize closed in `afterAll`.

### Edge cases
| Case | Expected |
|---|---|
| Three tabs from one participant; close two | count stays 1 |
| Presenter on two devices | presenter never counted |
| Ended while reconnecting | refetch on `connect` shows ended |
| Credential for A, auth asks for B | refused, generic UNAUTHORIZED |
| Server restart | clients reconnect and refetch; count rebuilds |
| Connecting to an already-ended session | allowed; snapshot shows ended; no further events |
| Redis down while connected | sockets kept; `REALTIME_DEGRADED` notice; restore → `REALTIME_RESTORED` → client refetches |
| fetchSockets fails | no emit; `/state` returns `connectedCount: null`; UI shows "—" |
| Publish rejection while Redis is down | must not crash the process (test it) |

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Approve and install `socket.io-client` (web dep + api devDep); confirm socket.io and redis-adapter with `npm ls` | LOW | inline | verified | socket.io 4.8.4, socket.io-client 4.8.4, redis-adapter 8.3.0, redis 4.7.1 |
| 2 | Shared realtime event contracts, handshake auth schema, state schema, ready `degraded` | LOW | executor-low | verified | shared 43 tests pass; ReadyData consumers: health.routes.ts only, still compiles |
| 3 | Move cookie-name helpers to lib/cookies.ts | LOW | inline | verified | typecheck 0, lint 0, unit 49 pass |
| 4 | Redis: pub/sub duplicates, connect, disconnect, degraded/restored hooks, offline queue off on pub | HIGH | executor-high | verified | verified; 5 Redis client tests; outage test fakes events (real outage in 12) |
| 5 | Readiness: Redis down → 200 degraded, Postgres down → 503 | MEDIUM | executor-medium | verified | verified; /ready degraded 200 when Redis down; 503 when Postgres down |
| 6 | Socket auth middleware (origin, caps, Zod, cookie checks, room join) | HIGH | executor-high | verified | verified; socket auth tests 6/6; socket.join in io.use confirmed by test |
| 7 | Presence (fetchSockets count, connect recount, grace timer, presenter-room emit) | HIGH | executor-high | verified | verified; presence tests 6/6; presenter never counted |
| 8 | `createRealtime` + `emitSessionEnded` + wiring into app/controller (`/end` emits after commit) | HIGH | executor-high | verified | verified; end notice reaches both sockets; emit on every successful end (repeat ends re-send) |
| 9 | `GET /api/sessions/:id/state` | MEDIUM | executor-medium | verified | verified; /state tests 6/6; countConnected null shown as unavailable |
| 10 | server.ts startup order and graceful shutdown | HIGH | executor-high | verified | verified; shutdown order and 10 s bound; publish guard for adapter rejection (real case) |
| 11 | Two-instance integration test (presence and ended across servers) | HIGH | executor-high | verified | verified; two-instance tests (presence, ended, state, isolation) |
| 12 | Redis-outage test (degraded notice, no socket drop, no crash, restore) | HIGH | executor-high | verified | verified; real outage via TCP proxy: stays connected, degraded, restored |
| 13 | Payload secrecy test over every event type | MEDIUM | executor-medium | verified | verified; payload-secrecy test over every event type and snapshot bodies |
| 14 | Web socket factory and `useSessionSocket` hook | HIGH | executor-high | verified | verified; web hook + reducer 20 cases; build 0; not run in a browser |
| 15 | Presenter dashboard: live count, Reconnecting…, degraded banner, ended | MEDIUM | executor-medium | verified | verified; presenter live count, degraded banner, ended; build 0 |
| 16 | Participant: ended immediately, Reconnecting…, refetch | MEDIUM | executor-medium | verified | verified; participant ended/reconnecting/refused states |
| 17 | Docs (05, 02) and tracking | LOW | executor-low | verified | verified; docs/05, 02, 04 updated (english); hindi stage file in progress |

## Approvals needed
- **A1 — `socket.io-client`** (web dependency for the browser; api devDependency for socket tests). No good alternative:
  raw WebSocket does not speak the Socket.IO protocol (rooms, reconnect, packets).
- **A2 — `/ready` contract change:** Redis down returns 200 `degraded` instead of 503.
- **A3 — New optional env vars:** `PRESENCE_GRACE_MS`, `SOCKET_MAX_PER_IP`, `SOCKET_MAX_PER_SESSION`.
- `socket.io`, `@socket.io/redis-adapter`, `redis` are already listed in api/package.json (to be confirmed with `npm ls`).

## Decisions (resolved 2026-10-24)
- **A1 approved:** `socket.io-client` ^4.8.0 added to web (dependency) and api (devDependency). Installed: 4.8.4.
- **A2 approved:** `/ready` returns 200 `degraded` when Redis is down; Postgres down still 503.
- **Q2:** websocket-only transport.
- **Q1:** degraded and restored reuse `session:error` with `REALTIME_DEGRADED` / `REALTIME_RESTORED`.
- **Defaults taken (not asked):** docs/05 updated to the implemented design (Q3 recommended); caps 20 per IP and 500
  per session per instance (Q5); ack shape `{ success, data | error }` for later phases (Q4).
- **A3:** optional env vars `PRESENCE_GRACE_MS` (5000), `SOCKET_MAX_PER_IP` (20), `SOCKET_MAX_PER_SESSION` (500) — taken
  as approved with the defaults above.

## Execution groups
| Group | Tasks | Executor |
|---|---|---|
| G1 | 1 (done: packages installed) | inline |
| G2 | 2 | executor-low |
| G3 | 3 | inline |
| G4 | 4 | executor-high |
| G5 | 5 | executor-medium |
| G6 | 6, 7, 8 | executor-high |
| G7 | 9 | executor-medium |
| G8 | 10, 11, 12 | executor-high |
| G9 | 13 | executor-medium |
| G10 | 14 | executor-high |
| G11 | 15, 16 | executor-medium |
| G12 | 17 | executor-low |

## Open questions
None blocking. Items 3–5 above were settled with the recommended defaults.

## Issues & updates
- **2026-10-24 · HIGH · Unhandled rejection in the Socket.IO Redis adapter:** `@socket.io/redis-adapter` 8.3 calls
  `pubClient.publish()` without a catch, so a Redis outage crashed the process through the unhandled-rejection exit.
  Fix: `logPublishFailures` in `api/src/realtime/index.ts` wraps the pub client's publish. Real case covered by a test.
  Other unhandled rejections still exit 1.
- **2026-10-24 · MEDIUM · Stale dev server blocked a clean start:** an earlier `tsx watch` process kept port 4000, so
  the new server failed with EADDRINUSE and the first live check ran against the old process. Re-run after a clean
  start: no bind error; live check passed. Stale dev processes were stopped.
- **2026-10-24 · MEDIUM · `REALTIME_DEGRADED` / `REALTIME_RESTORED` were not sent by production code** when first
  written by the tests. Added to `createRealtime` (subscribes to `redis.onStatusChange`).
- **2026-10-24 · LOW · Emit on every successful end:** the service does not say whether a call ended the session, so a
  repeated end re-sends `session:ended` with the original time. Clients ignore duplicates.
- **2026-10-24 · LOW · Presence grace gap:** a connect during another participant's grace window can briefly show one
  fewer (documented in the plan; countedAt ordering protects the client).
- **2026-10-24 · LOW · Shutdown order differs slightly from plan:** Redis closes before Sequelize (both inside 10 s).
- **2026-10-24 · NOT VERIFIED:** a real browser (web checked by unit tests and build, and by a live socket run from
  Node); per-IP cap race for simultaneous handshakes; per-session cap and TRUST_PROXY/X-Forwarded-For have no test;
  multi-instance shutdown; fetchSockets failure path under load; Redis error during the first milliseconds of startup.
- **2026-10-24 · RISK:** npm audit advisories from the foundation phase are still open (major upgrades needed).

<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-24 | plan_created | Plan v1 drafted by planner; awaiting approval (A1–A3, open questions 1–5) | planning-tracking.md |
| 2026-10-24 | decisions | Approved A1 (socket.io-client), A2 (/ready degraded); Q1 session:error codes; Q2 websocket only | planning-tracking.md, requirement.md |
| 2026-10-24 | build | Tasks 1–17 built in groups; each verified by the main session with real exit codes | api/, shared/, web/, docs/02, 04, 05 |
| 2026-10-24 | verify | Final run: lint 0 · typecheck 0 · unit 43+52+64 pass · web build 0 · prettier 0 · integration 110/110 pass · live dev run: socket handshake, presence 1, state 200, ended notice to both sockets | — |
