# sessions-and-join — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Sessions and joining

### Architecture
```
DB:  sessions(id uuid PK, room_code char(6) UNIQUE, title varchar(80) NOT NULL, description varchar(500) NULL,
       presenter_key_hash char(64) UNIQUE NOT NULL, status enum ACTIVE|ENDED default ACTIVE, ended_at NULL, timestamps)
       + CHECK (status='ENDED') = (ended_at IS NOT NULL)
     participants(id uuid PK, session_id uuid FK→sessions ON DELETE CASCADE, display_name varchar(30),
       token_hash char(64) UNIQUE, last_seen_at timestamptz, timestamps) + INDEX(session_id)
API: /api/sessions/* → validate (Zod) → controller → service → models
     middleware: rate-limit (in-memory fixed window), origin-check on POST, cookie read/serialise
Web: page → lib/api/sessions.ts (fetch, credentials 'include') → components/sessions/* (presentational)
Realtime: none (next phase)
```

### Key decisions
1. **Base path `/api`** for feature routes (docs/04). Health stays at root.
2. **Join and restore by room code, not session id.** `POST /api/sessions/by-code/:code/join`,
   `GET /api/sessions/by-code/:code/participant-me`. Reason: the public lookup must never expose internal IDs
   (requirement behaviour 10). **Departs from docs/04 — see Open question 1.**
3. **Per-session cookies, `Path=/api`.** Names `lp_presenter_<sessionId>` and `lp_participant_<sessionId>`.
   Flags `HttpOnly; SameSite=Lax; Path=/api; Max-Age=7d`; `Secure` only when `NODE_ENV=production`.
4. **Cookies hold raw random tokens** (32 bytes, base64url). The database stores only `sha256` of each. At 256 bits
   of entropy an unsalted SHA-256 is safe; bcrypt/argon2 would add a package without adding protection.
5. **Comparison.** Presenter: load session by id, `crypto.timingSafeEqual` on the hashes. Participant: look up by
   unique `token_hash`, then check `participant.session_id === session.id`, otherwise 401.
6. **Room code.** 6 characters from a 31-character set with no look-alikes, drawn with `crypto.randomInt`.
   Up to 5 attempts; each a separate INSERT outside any transaction; retry only on unique violation of `room_code`;
   otherwise `500 ROOM_CODE_UNAVAILABLE`.
7. **Rate limiting in-house** (in-memory fixed window, injectable clock, keyed by `req.ip`). Per process only;
   a Redis store replaces it when there are several API instances.
8. **No `/state` endpoint this phase.** Joined count is part of `GET /api/sessions/:id`. Reconnect snapshot arrives
   with realtime.
9. **CSRF defence:** SameSite=Lax, JSON-only bodies, and an origin check: a POST whose `Origin` is not in
   `WEB_ORIGIN` gets 403 `FORBIDDEN_ORIGIN`.
10. **CORS** `credentials: true` with the explicit `WEB_ORIGIN` list. Never `*`.
11. **Join link** `${WEB_ORIGIN[0]}/join?code=XXXXXX`, built by the API.
12. **Web API base URL:** `web/src/lib/config.ts` reads `NEXT_PUBLIC_API_URL` (Zod-checked, default
    `http://localhost:4000` outside production). Documented in `.env.example`.
13. **Joining again from the same browser** with a valid cookie for that session returns the existing participant
    with `200`; a first join returns `201`.

### Contracts (HTTP, envelope from `shared/src/schemas/api.ts`)
| Endpoint | Who | Request | Success | Errors |
|---|---|---|---|---|
| `POST /api/sessions` | Public, 10 / IP / hour | `{title 1–80, description? ≤500}` | `201 {sessionId, roomCode, joinUrl, presenterKey}` + presenter cookie | 400 · 403 FORBIDDEN_ORIGIN · 429 · 500 ROOM_CODE_UNAVAILABLE |
| `GET /api/sessions/by-code/:code` | Public, shares join bucket | code trimmed, uppercased | `200 {title, status, roomCode}` only | 400 · 404 NOT_FOUND · 429 |
| `POST /api/sessions/by-code/:code/join` | Public, 20 / IP / min | `{displayName 1–30}` | `201` (`200` if already joined) `{participant:{displayName}, session:{title,status,roomCode}}` + participant cookie | 400 · 403 · 404 SESSION_NOT_OPEN · 429 |
| `GET /api/sessions/by-code/:code/participant-me` | Participant cookie | – | `200 {participant:{displayName}, session:{title,status,roomCode}}` | 400 · 401 PARTICIPANT_AUTH_REQUIRED · 404 |
| `GET /api/sessions/:id` | Presenter cookie | uuid | `200 {id,title,description,roomCode,joinUrl,status,endedAt,participantCount}` | 400 · 401 PRESENTER_AUTH_REQUIRED · 404 |
| `POST /api/sessions/:id/presenter-access` | Public, 10 / session / 15 min | `{presenterKey}` trimmed, 20–100 chars | `204` + presenter cookie | 400 · 401 INVALID_PRESENTER_KEY · 403 · 404 · 429 |
| `POST /api/sessions/:id/end` | Presenter cookie | – | `200` presenter DTO; ending again also `200`, `ended_at` unchanged | 400 · 401 · 403 · 404 |

Error messages never contain the key, a hash, or SQL. Rate-limited responses: 429 `RATE_LIMITED`,
"Too many attempts, try again shortly", with `Retry-After`.

### Files
| File | C/M | Purpose | Risk |
|---|---|---|---|
| `shared/src/schemas/sessions.ts` (+test), `shared/src/index.ts` | C/M | Alphabet, room code, title, description, display name, presenter key schemas; DTO schemas | MEDIUM |
| `api/migrations/<timestamp>-create-sessions-and-participants.cjs` | C | `up`: tables, enum, check, indexes in one transaction. `down`: drop participants, sessions, enum | HIGH |
| `api/package.json` | M | Script `db:migration:generate` | LOW |
| `api/src/models/{session,participant}.model.ts`, `models/index.ts` | C | Typed models, associations, `initModels` | MEDIUM |
| `api/src/lib/tokens.ts` (+test) | C | `generateToken`, `hashToken`, `safeEqualHash` | HIGH |
| `api/src/lib/room-code.ts` (+test) | C | Generator with injectable random source | MEDIUM |
| `api/src/lib/cookies.ts` (+test) | C | Parse Cookie header; serialise Set-Cookie | HIGH |
| `api/src/middleware/{validate,rate-limit,origin-check,presenter-auth,participant-auth}.ts` | C | Validation, limiter, origin check, auth | HIGH |
| `api/src/services/{sessions,participants}.service.ts` | C | Create with retry, get, end, presenter access, join, me | HIGH |
| `api/src/controllers/sessions.controller.ts`, `api/src/routes/sessions.routes.ts` | C | HTTP wiring, DTO mappers | MEDIUM |
| `api/src/app.ts`, `api/src/server.ts` | M | `AppDeps` gains `sequelize`; mount `/api`; CORS credentials | MEDIUM |
| `api/src/config/env.ts` (+test) | M | Optional `TEST_DATABASE_URL`, `TRUST_PROXY` (default false) | LOW |
| `api/tests/helpers/test-db.ts`, `api/tests/global-setup.ts`, `api/vitest.config.ts` | C/M | Test-DB guard, migrate test DB, truncate between tests | HIGH |
| `api/tests/integration/{sessions,join,presenter-access,rate-limit}.test.ts` | C | Supertest against real Postgres | MEDIUM |
| `api/tests/integration/app.test.ts` | M | Pass new dependency | LOW |
| `web/src/lib/{config,api/sessions}.ts` (+tests), `web/vitest.config.ts` | C/M | Typed client → `{ok,data} \| {ok:false,status,code,message,fields}` | MEDIUM |
| `web/src/components/sessions/*` | C | CreateForm, SessionCreatedPanel, JoinForm, PresenterKeyForm, PresenterDashboard, ParticipantView, StatusMessage | MEDIUM |
| `web/src/app/{create,join,presenter/[sessionId],session/[roomCode]}/page.tsx` | C | Pages | MEDIUM |
| `web/src/app/page.tsx` (+test) | M | Buttons become links | LOW |
| `.env.example`, `docs/09`, `docs/03`, `docs/04`, `docs/06` | M | New keys, test DB, cookie auth, by-code routes | LOW |

### Impact analysis
- **Breaking changes:** `createApp` gains a `sequelize` dependency (update `app.test.ts`). CORS becomes
  `credentials: true`. The landing page test changes. **Doc drift:** docs/04 (bearer and `X-Participant-Token`
  headers → cookies; join and me move to by-code routes; `/state` deferred), docs/06 and docs/03 need matching
  updates.
- **Migrations / rollback:** first schema, additive. `down` **destroys all session and participant data** — fine on
  dev and test databases; running it where real data exists needs approval. Never `undo:all`.
- **Concurrency:**
  - Room-code collisions: retry on unique violation only.
  - Join vs end: join runs in a transaction that loads the session with `FOR SHARE`, checks ACTIVE, then inserts.
    End runs `UPDATE … WHERE id=? AND status='ACTIVE'`, then re-reads (idempotent). End waits for in-flight joins;
    no join commits after end commits.
  - Same browser joining from two tabs at once may create two participants. Accepted and documented.
- **Security:** cookie flags as above; hashed tokens; timing-safe comparison; no hashes in responses; key only in
  POST body or cookie; request logger logs path only; validation errors never echo the key; generic not-found.
- **Testing:** integration suite refuses to run unless `NODE_ENV=test`, `TEST_DATABASE_URL` is set, and its database
  name ends in `_test`. Never falls back to `DATABASE_URL`. Each success criterion has at least one test. Collision
  test: injected generator returns the same code first; two concurrent creates both succeed with different codes.
  Web: `renderToStaticMarkup` of presentational components in each state.

### Edge cases
- Key or code pasted with spaces → trimmed; lowercase code → uppercased.
- Join link after end → ended message (lookup returns `ENDED`).
- Ending twice is harmless.
- Participant cookie from session A sent to session B → 401.
- Five collisions in a row → safe 500.
- Duplicate display names allowed.
- Unknown session id on presenter routes → 404.
- Ended session: presenter can still view; participant-me returns `ENDED`.
- Body over 100 kb → 413 (existing).

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Shared session schemas, DTOs, alphabet; export | MEDIUM | executor-medium | verified (partial) | shared 28 tests pass (18 new); typecheck, lint, prettier pass; executor built from spec without reading requirement — to review |
| 2 | Env additions, test-DB guard, global setup, `db:migration:generate` script, docs/09 test-DB steps | HIGH | executor-high | verified | 15 unit tests; integration refuses dev DB and non-`_test` names; migrations run on test DB via global setup |
| 3 | Generate migration (`.cjs`, `up`/`down`) | HIGH | executor-high | verified | up, down, up on `livepulse_test`; constraints and cascade confirmed; duplicate room code rejected |
| 4 | Models and `initModels` | MEDIUM | executor-medium | verified | 5 model integration tests pass |
| 5 | `tokens`, `room-code`, `cookies` libs + unit tests | HIGH | executor-high | verified | unit suite 37 pass; alphabet is 31 characters (plan said 32 — corrected) |
| 6 | `validate`, `rate-limit`, `origin-check` middleware | MEDIUM | executor-medium | verified | 12 new unit tests; typecheck re-run by main session |
| 7 | Sessions service: create with retry, get, end, presenter access | HIGH | executor-high | verified | race test found an `ended_at` ordering bug; `endSession` moved into a locking transaction |
| 8 | Participants service: join with `FOR SHARE`, me | HIGH | executor-high | verified | join-vs-end race test passes; same-browser rejoin returns the existing participant |
| 9 | Auth/cookies, controller, routes; wire `app.ts`/`server.ts`; CORS credentials | HIGH | executor-high | verified | integration suite 58 of 58 pass (re-run by main session) |
| 10 | Web config and typed API client, with tests | MEDIUM | executor-medium | verified | web tests pass; `next.config.ts` got `transpilePackages` for shared |
| 11 | Landing, create and join pages and components | MEDIUM | executor-medium | verified | build lists `/create` and `/join` |
| 12 | Presenter page and participant page | MEDIUM | executor-medium | verified | build lists dynamic presenter and session routes; `INVALID_PRESENTER_KEY` now mapped explicitly (main session) |
| 13 | Update docs/03, 04, 06, `.env.example`, tracking | LOW | executor-low | verified | docs/04 whitespace re-aligned by prettier (noted) |
| 14 | Two-browser check over HTTP with separate cookie jars | LOW | inline | verified (partial) | 12-step flow passes; NOT a real browser; cookie behaviour across ports in a real browser not observed |

## Approvals needed
- **A1 — Packages:** none proposed. Built-ins replace `cookie-parser` and `express-rate-limit`. Say if you prefer
  `express-rate-limit` instead.
- **A2 — Test database:** create `livepulse_test` in the local Postgres (one `createdb`, documented in docs/09).
- **A3 — Destructive `down` migration:** approval needed before running it where real data exists.

## Decisions (resolved 2026-10-24)
1. **Join and restore by room code** (`/api/sessions/by-code/:code/join`, `.../participant-me`). docs/04 gets updated.
2. **Public lookup shares the join bucket** (20 per IP per minute).
3. **Test database created manually** (`livepulse_test`, created 2026-10-24 in the local container; documented in docs/09).
4. **Plan v1 approved**, with defaults: 7-day cookies, `Secure` only in production, in-memory per-process rate limiting.
   No new packages. The destructive `down` migration runs only on the test database.

## Execution groups
| Group | Tasks | Executor |
|---|---|---|
| G1 | 1 | executor-medium |
| G2 | 2, 3 | executor-high |
| G3 | 4 | executor-medium |
| G4 | 5 | executor-high |
| G5 | 6 | executor-medium |
| G6 | 7, 8, 9 | executor-high |
| G7 | 10, 11, 12 | executor-medium |
| G8 | 13 | executor-low |
| G9 | 14 | inline (manual browser check) |

## Issues & updates
- **2026-10-24 · MEDIUM · Room-code alphabet size:** requirement and plan said 32 characters; the alphabet without
  0, O, 1, I, L has 31. Code reads the alphabet from shared (31 is correct); requirement and plan corrected.
- **2026-10-24 · HIGH · Race between join and end (found by the race test):** `ended_at` was set before a concurrent
  join's lock was released, so it could be earlier than the participant's `created_at`. Fix: `endSession` runs in a
  transaction that locks the row and sets `ended_at` after the wait. Re-verified green.
- **2026-10-24 · MEDIUM · Dev database not migrated:** `livepulse` had no sessions tables, so the API returned 500.
  Resolved by running `npm run db:migrate` (up only) on the dev database. Required once per fresh database.
- **2026-10-24 · LOW · Race test coverage:** the join-vs-end test may not have hit both the rejected and accepted
  paths in every run. Not verified; consider a deterministic ordering test later.
- **2026-10-24 · LOW · Prettier re-aligned docs/04 tables** (whitespace only, including sections outside this
  feature). Revert if unwanted.
- **2026-10-24 · LOW · docs/04 error-code list** lacks FORBIDDEN_ORIGIN, PRESENTER_AUTH_REQUIRED,
  PARTICIPANT_AUTH_REQUIRED, INVALID_PRESENTER_KEY, SESSION_NOT_OPEN, ROOM_CODE_UNAVAILABLE. Not yet added.
- **2026-10-24 · LOW · Next build warning:** "Next.js plugin was not detected in your ESLint configuration". Build
  passes; the ESLint config should add the Next plugin later.
- **2026-10-24 · NOT VERIFIED:** real browser cookie behaviour across ports 3000 and 4000 (checked over HTTP only);
  TRUST_PROXY behind a real proxy; clipboard copy; the end-confirmation click flow in a browser.
- **2026-10-24 · RISK:** 3 high/critical npm advisories remain from the foundation phase (major upgrades needed).

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-24 | plan_created | Plan v1 drafted by planner; awaiting approval (open questions 1–6, approvals A1–A3) | planning-tracking.md |
| 2026-10-24 | decisions | Plan v1 approved; join by room code; lookup shares join bucket; manual test DB; room-code alphabet corrected to 31 | planning-tracking.md, requirement.md |
| 2026-10-24 | build | Tasks 1–13 built in groups and verified per task; task 14 checked over HTTP | api/, shared/, web/, docs/03, 04, 06, 09, .env.example |
| 2026-10-24 | verify | Final run: lint 0 · typecheck 0 · unit 49 pass · web 35 pass · web build 0 · prettier 0 · integration 58 pass | — |
