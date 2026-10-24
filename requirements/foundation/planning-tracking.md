# foundation — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Project skeleton

### Architecture
```
Root: npm workspaces [shared, api, web]; tsconfig.base.json (strict); Prettier; ESLint flat config
Compose: postgres (pgvector/pgvector:pg16, volume pgdata, healthcheck pg_isready, host 5432)
         redis (redis:7, healthcheck redis-cli ping, host 6379)
Env (api, Zod): NODE_ENV, PORT, WEB_ORIGIN (comma list), DATABASE_URL, REDIS_URL, LOG_LEVEL
API: src/config/{env,logger,sequelize-cli.cjs}  src/db/{sequelize,redis}  src/errors/app-error
     src/middleware/{request-id,not-found,error-handler}  src/services/readiness.service
     src/routes/health.routes  src/app.ts (createApp(deps))  src/server.ts (bootstrap)
     migrations/ (empty)  .sequelizerc
Ops: GET /health  -> 200 {success:true, data:{status:'ok'}}
     GET /ready   -> 200 {success:true, data:{status:'ready', checks:{postgres:'up', redis:'up'}}}
                  -> 503 {success:false, error:{code:'NOT_READY', message, details:{postgres, redis}, requestId}}
Web: Next.js App Router + Tailwind: layout.tsx, placeholder page.tsx
Realtime: none (socket.io installed, not wired)
```

### Key decisions
1. **`createApp(deps)` factory** — readiness checks are injected, so Supertest runs without Docker.
2. **Redis fails fast only at startup** — connect retries are capped before first connect (process exits with a clear message); after a successful start it retries forever, so `/ready` recovers without restart. An `error` listener is mandatory.
3. **PostgreSQL is not fatal at startup** — its status appears in `/ready`. Each check has a 1 s timeout. (The requirement only mandates fail-fast for Redis.)
4. **No migrations this phase** — no data model is in scope. First `db:migrate` creates `SequelizeMeta`. Migrations are `.cjs` so sequelize-cli needs no ts-node. Pgvector extension is deferred to phase 9; only the image is used now.
5. **`shared` consumed as TS source** — api runs with tsx and type-checks with `tsc --noEmit`; no build step this phase.
6. **Request ID** — incoming `X-Request-Id` accepted only if it matches `^[\w-]{1,64}$`, otherwise `crypto.randomUUID()`. Echoed in header, error bodies and logs.
7. **Hardening** — JSON body limit 100 kb; malformed JSON → 400 `VALIDATION_ERROR`; pino redacts `authorization`, `cookie`, `x-participant-token`; request bodies never logged.
8. **Web test** — `react-dom/server` `renderToStaticMarkup` in node environment (no jsdom/Testing Library).

### Contracts
- HTTP: `GET /health` — 200, public, no version/host.
- HTTP: `GET /ready` — 200 when PostgreSQL and Redis respond; 503 with generic `NOT_READY` otherwise. Public (no secrets in body).
- HTTP errors: envelope shape **pending decision D1** below. Unknown route → 404 envelope with `requestId`.
- Socket: none.

### Files
| File | Create/Modify | Purpose | Risk |
|---|---|---|---|
| `package.json`, `tsconfig.base.json`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, `.gitignore` | Create | Workspaces, tooling, `.env` ignored | LOW |
| `shared/{package.json,tsconfig.json,vitest.config.ts}`, `src/index.ts`, `src/schemas/api.ts`, `src/schemas/api.test.ts` | Create | Envelope + health/ready Zod schemas | MEDIUM |
| `docker-compose.yml`, `.env.example` | Create | Local services, placeholder env | MEDIUM |
| `api/{package.json,tsconfig.json,vitest.config.ts,.sequelizerc}` | Create | Workspace, CLI paths | LOW |
| `api/src/config/env.ts`, `env.test.ts` | Create | Zod env; fail fast; names keys only | HIGH |
| `api/src/config/logger.ts` | Create | pino with redaction | MEDIUM |
| `api/src/config/sequelize-cli.cjs` | Create | CLI config from `DATABASE_URL` | MEDIUM |
| `api/src/errors/app-error.ts`, `api/src/middleware/{request-id,not-found,error-handler}.ts` | Create | Error envelope, request ID, 404 | HIGH |
| `api/src/app.ts` | Create | helmet, CORS allowlist, JSON limit, routes | HIGH |
| `api/src/db/sequelize.ts`, `api/src/db/redis.ts`, `api/src/server.ts` | Create | Connections, fail-fast, graceful shutdown | HIGH |
| `api/src/services/readiness.service.ts`, `api/src/routes/health.routes.ts` | Create | Liveness and readiness | MEDIUM |
| `api/tests/integration/app.test.ts` | Create | Supertest behaviour | MEDIUM |
| `api/migrations/.gitkeep` | Create | Migrations directory | LOW |
| `web/{package.json,tsconfig.json,next.config.ts,postcss.config.mjs,vitest.config.ts}`, `web/src/app/{layout.tsx,page.tsx,globals.css,page.test.tsx}` | Create | Web shell | LOW |
| `README.md` | Modify | Run steps (Windows port-clash note) | LOW |

### Impact analysis
- **Breaking changes**: none (no existing code).
- **Migrations / rollback**: none this phase. No `sync()`. Rollback = delete files; no data affected.
- **Concurrency**: none in this phase.
- **Security**: env validated at boot, errors list key names only; no secrets in logs; generic 500/503 bodies; helmet defaults; CORS uses explicit origins from `WEB_ORIGIN`, never `*`; `.env` gitignored, `.env.example` placeholders only.
- **Testing approach**: `shared` schema tests; api env unit test + Supertest against `createApp` with stub checks (no DB); real outage (Redis stop → 503 → recover) verified by hand with Docker; web renders page server-side.

### Edge cases
- Redis drops mid-run → `/ready` 503, recovers on its own.
- Hanging PostgreSQL check → capped by 1 s timeout.
- Spoofed/oversized `X-Request-Id` → replaced.
- Unknown route → 404 envelope.
- Ports 5432/6379 already in use on Windows → README note.
- `next build` must not need api env.

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Root workspace, tsconfig base, Prettier, ESLint, .gitignore | LOW | executor-low | verified | lint and prettier pass; .gitignore unchanged (already complete) |
| 2 | `shared` package + schemas + test | LOW | executor-low | verified | 10 tests pass (executor's count of 11 was wrong) |
| 3 | Compose + `.env.example` | LOW | executor-low | verified | `docker compose up -d` → postgres and redis healthy; `config -q` exit 0 |
| 4 | api env + logger + env unit test | MEDIUM | executor-medium | verified | 8 env tests pass; `_omitted` lint error fixed |
| 5 | Errors, request ID, error handler, 404, `createApp` (helmet/CORS) | HIGH | executor-high | verified (partial) | 404/400 envelopes and CORS checked; 413 covered by test in task 8; unhandled-error handlers not exercised |
| 6 | Sequelize + Redis clients, `server.ts` fail-fast + shutdown, `.sequelizerc`, CLI config, db scripts | HIGH | executor-high | verified (partial) | migrate/status/undo OK; Redis-down startup exits 1; SIGINT/SIGTERM graceful shutdown NOT verified |
| 7 | Readiness service + health routes | MEDIUM | executor-medium | verified | live: 200 ready; Postgres stopped → 503 `postgres:down`; Redis stopped → 503 `redis:down`; both recover to 200 without restart |
| 8 | api integration tests | MEDIUM | executor-medium | verified | `npm test -w api`: 22 passed, 2 skipped (real-DB file skipped unless env set); real-DB file: 2 passed with env set |
| 9 | Web shell + Tailwind + page test | MEDIUM | executor-medium | verified | typecheck, 2 tests, `next build` (no env) exit 0, dev server returns 200, lint and prettier pass |
| 10 | Root scripts + README run steps | LOW | inline | verified | added `dev:api`, `dev:web`, `db:migrate`; `.env` now loaded by API and migrations (see Issues) |

### Verification (run at the end, not yet run)
```
docker compose up -d && docker compose ps
npm install
npm run lint && npm run typecheck -w api
npm test -w shared && npm test -w api && npm test -w web
npm run db:migrate -w api && npm run db:migrate:status -w api
npm run dev -w api   # curl -i localhost:4000/health ; curl -i localhost:4000/ready
docker compose stop redis   # /ready -> 503 ; docker compose start redis -> 200
# Redis stopped at api start -> process exits non-zero with a clear message
npm run build -w web && npm run dev -w web   # localhost:3000
```
Script names are the plan's proposal; they must match the `package.json` scripts actually written.

## Decisions (resolved 2026-10-23)
- **D1 — Error envelope:** `{ success: false, error: { code, message, details?, requestId } }` (docs/04). `.claude/rules/backend-api.md` updated to match.
- **D2 — Extra packages approved:** `@types/node`, `@types/express`, `@types/cors`, `@types/supertest`, `@types/react`, `@types/react-dom`, `typescript-eslint`, `@eslint/js`, `@tailwindcss/postcss` (Tailwind v4).
- **D3 — Versions:** Express 5 · Next 15 · Tailwind v4.
- **D4 — Migrations:** zero this phase; runner verified on an empty DB. First real migration in phase 3.
- **D5 — Doc follow-up (open):** `docs/02` §5 and `docs/09` mention `REDIS_REQUIRED`; drop it after execution (doc-only).

## Execution groups
| Group | Tasks | Executor |
|---|---|---|
| A | 1, 2, 3 | executor-low |
| B | 4 | executor-medium |
| C | 5, 6 | executor-high |
| D | 7, 8 | executor-medium |
| E | 9 | executor-medium |
| F | 10 | inline |

## Issues & updates
- **2026-10-23 · HIGH · Environment:** Node.js, npm and Docker are not installed on this machine (`node`, `npm`,
  `docker` not found). Group A files (tasks 1–3) are written but unverified: `npm install`, prettier, eslint,
  `npm test -w shared`, and `docker compose config` have not run. Blocks all later groups' verification.
  Resolution: install Node.js LTS and Docker Desktop (developer action), then re-run group A verification.
- **2026-10-23 · LOW · Task 1:** `.gitignore` already existed and covers all required entries; left unchanged.
- **2026-10-23 · LOW · Task 2:** `api/` and `web/` workspaces are listed in root `package.json` but their
  `package.json` files don't exist yet, so `npm install` will fail until group B/E create them. Dependency ranges
  were chosen by the executor (caret), not yet resolved to a lockfile.
  — Resolved: `npm install` succeeded after group B/E.
- **2026-10-24 · HIGH · Environment resolved:** Node 24 and Docker 29 are installed; all verification ran.
- **2026-10-24 · MEDIUM · Dependency audit:** `npm install` reports 9 vulnerabilities (5 moderate, 2 high,
  2 critical). Not fixed: `npm audit fix --force` changes major versions and needs your approval. Run `npm audit`
  to review; decide before the first release.
- **2026-10-24 · MEDIUM · `.env` not loaded by scripts (found in README check):** the README told the developer to
  copy `.env.example` to `.env`, but nothing read it. Fixed in `api/src/server.ts` and
  `api/src/config/sequelize-cli.cjs` with `process.loadEnvFile` (only when the repo-root `.env` exists; real
  environment variables win). Verified: `npm run dev:api` serves 200/200 with no inline env.
- **2026-10-24 · LOW · Root `dev` script:** plan said `dev` at root; `concurrently` is not approved, so the root
  has `dev:api` and `dev:web` and the README asks for two terminals.
- **2026-10-24 · LOW · Root ESLint config changed by the web executor:** added `**/next-env.d.ts` to ignores
  (Next's generated triple-slash reference). Also added a `.cjs` block (Node globals, `require` allowed) for
  sequelize-cli config.
- **2026-10-24 · LOW · Temporary tool fetch:** the web executor ran `npx --yes kill-port` to stop a dev server.
  Not in any `package.json`; not a dependency.
- **2026-10-24 · LOW · Redis connect timeout:** added a 10 s cap on initial connect in `api/src/db/redis.ts` after a
  hung connection to a local port (Windows dual-stack) stalled startup with no output.
- **2026-10-24 · LOW · Request logging:** `pino-http` is not approved, so request logs use a small custom middleware
  (method, path, status, duration, request ID only).
- **2026-10-24 · NOT VERIFIED:** SIGINT/SIGTERM graceful shutdown (only `taskkill /F` tested); unhandled
  rejection/exception handlers; the 1 s readiness timeout on a hanging dependency.
- **2026-10-24 · DEFERRED (by design):** the second Redis client for `@socket.io/redis-adapter` is not created
  until sockets are wired (realtime phase).
- **2026-10-24 · OPEN (doc only, D5):** `docs/02` §5 and `docs/09` still mention `REDIS_REQUIRED`; drop it.

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-23 | plan_created | Plan v1 drafted by planner; awaiting approval (D1–D5) | planning-tracking.md |
| 2026-10-23 | decisions | D1–D4 approved; rule file `backend-api.md` aligned to D1 envelope | planning-tracking.md, .claude/rules/backend-api.md |
| 2026-10-24 | build | Groups A–E built; verification run for each; Node 24 and Docker 29 available | api/, shared/, web/, docker-compose.yml, .env.example, package.json, README.md, eslint.config.mjs |
| 2026-10-24 | fix | API loads repo-root `.env` (README run steps); ESLint `.cjs` and next-env ignores | api/src/server.ts, api/src/config/sequelize-cli.cjs, eslint.config.mjs |
| 2026-10-24 | verify | `npm run lint` exit 0; `npm run typecheck` exit 0; `npm test` shared 10 pass, api 22 pass + 2 skipped, web 2 pass; `npm run db:migrate` exit 0; live `/health` 200, `/ready` 200, Redis stopped → 503 `redis:down`, recovered 200 | — |
