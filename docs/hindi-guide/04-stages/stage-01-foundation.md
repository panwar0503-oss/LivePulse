# Stage 01 — `foundation` (नींव)

> स्रोत: `requirements/foundation/requirement.md` (आगे "requirement"), `requirements/foundation/planning-tracking.md`
> (आगे "tracking"), `git log --oneline`, `git show --stat f382ca2`।
> Roadmap में यह **Phase 2** है (`docs/08-implementation-plan.md` line 12)।

## लक्ष्य

LivePulse का skeleton (ढाँचा) तैयार करना, ताकि आगे के features बनाए और test किए जा सकें। Requirement line 18–21:
developer project clone करके एक command से local services (PostgreSQL, Redis) चला सके, backend और web shell
चला सके; backend बताए कि वह ज़िंदा है और उसकी dependencies reachable हैं — बिना कोई secret दिखाए। Schema बदलाव
सिर्फ़ versioned migrations से। Visitor के लिए अभी कोई feature नहीं।

## requirement का सार

**Original request** (requirement line 10–15): npm workspaces (`api`, `web`, `shared`) + TypeScript, Prettier/ESLint,
Docker Compose (pgvector वाला PostgreSQL + Redis, health checks, persistent volume), Zod से env validation,
placeholders वाला `.env.example`, Express app (structured logging, request IDs, एक जैसा error envelope, Helmet,
CORS allowlist), Sequelize connection + migration runner (no `sync`), `GET /health` और `GET /ready`, Next.js App
Router + Tailwind shell, और हर workspace में Vitest (+ Supertest) के साथ कम-से-कम एक passing test।

**Users** (line 23–25): Developer (evaluator) और Operator (जो `/health`, `/ready` पढ़ता है)।

**Key behaviours** (line 33–45), संक्षेप में:

| # | व्यवहार |
|---|---|
| 1 | PostgreSQL (vector support) और Redis एक command से start, healthy; container restart पर data बचे |
| 2 | ज़रूरी setting missing/invalid → backend start नहीं होगा; error में setting का **नाम**, value कभी नहीं |
| 3 | Redis reachable नहीं → backend start नहीं होगा |
| 4 | `/health` OK जब तक process चल रहा है; version/host/config नहीं दिखाता |
| 5 | `/ready` OK सिर्फ़ तब जब PostgreSQL और Redis दोनों reachable हों; नहीं तो 503 generic status |
| 6 | हर error response एक shape में, request ID के साथ; stack trace या DB details नहीं |
| 7 | Allowlist से बाहर के origins को browser refuse करे (CORS) |
| 8 | Migrations खाली DB पर schema बनाएँ और revert करें; automatic sync नहीं |
| 9 | Web app में placeholder landing page |
| 10 | हर workspace के test commands pass |

**Out of scope** (line 74–79): कोई product feature नहीं (sessions, polls, Q&A, reactions, AI), Socket.IO wiring नहीं
(package सिर्फ़ install), auth/presenter keys नहीं, deployment/CI नहीं।

**Success criteria** (line 98–107): 9 criteria — services healthy, missing setting पर साफ़ message बिना value, Redis
बंद हो तो start fail, `/health` 200, `/ready` 200/503, error में request ID बिना stack, migrations apply/revert,
landing page load, तीनों workspaces के tests pass।

### Clarification में पूछे गए 4 सवाल और जवाब

Requirement की change log (line 116) कहती है: *"Created and confirmed (migration runner, Redis policy, web scope,
dependency list)"*। जवाब Assumptions (line 81–85) में दर्ज हैं। सवालों का exact शब्द-दर-शब्द text कहीं दर्ज नहीं
है (पुष्टि नहीं हुई) — नीचे विषय और दर्ज जवाब हैं:

| # | सवाल का विषय | जवाब (developer ने चुना) | स्रोत |
|---|---|---|---|
| 1 | Migration runner कौन सा? | `sequelize-cli` | Assumption 1, line 82 |
| 2 | Redis की policy — optional या required? | Required; startup पर Redis न मिले तो backend fail fast (तुरंत बंद) | Assumption 2, line 83 |
| 3 | Web का scope कितना? | सिर्फ़ shell और placeholder landing page | Assumption 3, line 84 |
| 4 | Dependency list | Foundation का package set approved; इसके अलावा कोई भी package दोबारा approval के लिए आएगा | Assumption 4, line 85 |

Assumption 5 (line 86): developer की machine पर Docker Desktop उपलब्ध होगा — यही बाद में रुकावट बना (नीचे देखें)।

**Risks** (line 88–92): HIGH — Docker न चले तो verification रुकेगा; MEDIUM — pgvector image platform-specific;
MEDIUM — fail-fast Redis से पहला start मुश्किल; LOW — tooling versions का drift।

## plan का सार

Planner का plan v1 (tracking line 5–72)।

**Architecture** (line 8–22): root पर npm workspaces `[shared, api, web]`, strict `tsconfig.base.json`; Compose में
`pgvector/pgvector:pg16` (volume `pgdata`, healthcheck `pg_isready`) और `redis:7` (healthcheck `redis-cli ping`);
env keys `NODE_ENV, PORT, WEB_ORIGIN, DATABASE_URL, REDIS_URL, LOG_LEVEL`; API में `createApp(deps)` factory और
`server.ts` bootstrap; `/health` और `/ready` के response shapes; web में Next.js layout + placeholder page;
realtime नहीं।

**Key decisions** (line 24–32):
1. `createApp(deps)` factory — readiness checks inject (बाहर से दिए) होते हैं, ताकि Supertest बिना Docker चले।
2. Redis सिर्फ़ startup पर fail fast — पहली connection से पहले retries सीमित; सफल start के बाद हमेशा retry, ताकि
   `/ready` बिना restart recover करे। `error` listener ज़रूरी।
3. PostgreSQL startup पर fatal नहीं — उसका status `/ready` में। हर check का 1 s timeout।
4. इस phase में कोई migration नहीं; पहला `db:migrate` सिर्फ़ `SequelizeMeta` table बनाता है। Migrations `.cjs`
   ताकि sequelize-cli को ts-node न चाहिए। pgvector extension phase 9 में।
5. `shared` को TS source की तरह consume किया जाता है — कोई build step नहीं।
6. Request ID — आने वाला `X-Request-Id` सिर्फ़ `^[\w-]{1,64}$` से match करे तो स्वीकार, वरना `crypto.randomUUID()`।
7. Hardening — JSON body limit 100 kb; खराब JSON → 400 `VALIDATION_ERROR`; pino कुछ headers redact करता है;
   request bodies कभी log नहीं।
8. Web test — `react-dom/server` का `renderToStaticMarkup`, node environment में (jsdom या Testing Library नहीं)।

**Edge cases** (line 66–72): Redis बीच में गिरे → 503 और खुद recover; PostgreSQL check hang → 1 s cap;
spoofed/बहुत लंबा `X-Request-Id` → बदल दिया जाता है; unknown route → 404 envelope; Windows पर 5432/6379 port पहले
से busy → README note; `next build` को api env नहीं चाहिए।

### Decisions D1–D5 (tracking line 102–107, 2026-10-23 को resolve)

| ID | Decision (फ़ैसला) |
|---|---|
| D1 | Error envelope: `{ success: false, error: { code, message, details?, requestId } }` (docs/04 के अनुसार)। `.claude/rules/backend-api.md` इसी से मिलाया गया |
| D2 | Extra packages approved: `@types/node`, `@types/express`, `@types/cors`, `@types/supertest`, `@types/react`, `@types/react-dom`, `typescript-eslint`, `@eslint/js`, `@tailwindcss/postcss` (Tailwind v4) |
| D3 | Versions: Express 5 · Next 15 · Tailwind v4 |
| D4 | इस phase में zero migrations; runner खाली DB पर verify। पहली असली migration phase 3 में |
| D5 | Doc follow-up (**open**): `docs/02` §5 और `docs/09` में `REDIS_REQUIRED` का ज़िक्र है; execution के बाद हटाना है (सिर्फ़ doc) |

## tasks table

Tracking line 74–86:

| # | Task | Complexity | Executor | Status | किसमें क्या बना / नोट |
|---|---|---|---|---|---|
| 1 | Root workspace, tsconfig base, Prettier, ESLint, `.gitignore` | LOW | executor-low | verified | `package.json`, `tsconfig.base.json`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`; `.gitignore` पहले से पूरा था, बदला नहीं |
| 2 | `shared` package + schemas + test | LOW | executor-low | verified | `shared/src/schemas/api.ts` + 10 tests (executor ने 11 बताए थे — ग़लत) |
| 3 | Compose + `.env.example` | LOW | executor-low | verified | `docker compose up -d` → दोनों healthy; `config -q` exit 0 |
| 4 | api env + logger + env unit test | MEDIUM | executor-medium | verified | `env.ts`, `logger.ts`, 8 env tests; `_omitted` lint error ठीक किया |
| 5 | Errors, request ID, error handler, 404, `createApp` (helmet/CORS) | HIGH | executor-high | verified (partial) | 404/400 envelopes और CORS check; 413 task 8 के test में; unhandled-error handlers exercise नहीं हुए |
| 6 | Sequelize + Redis clients, `server.ts` fail-fast + shutdown, `.sequelizerc`, CLI config, db scripts | HIGH | executor-high | verified (partial) | migrate/status/undo OK; Redis बंद हो तो startup exit 1; **SIGINT/SIGTERM graceful shutdown verify नहीं** |
| 7 | Readiness service + health routes | MEDIUM | executor-medium | verified | Live: 200 ready; Postgres रोका → 503 `postgres:down`; Redis रोका → 503 `redis:down`; दोनों बिना restart 200 पर लौटे |
| 8 | api integration tests | MEDIUM | executor-medium | verified | `npm test -w api`: 22 passed, 2 skipped; real-DB file env के साथ 2 passed |
| 9 | Web shell + Tailwind + page test | MEDIUM | executor-medium | verified | typecheck, 2 tests, `next build` (बिना env) exit 0, dev server 200, lint/prettier pass |
| 10 | Root scripts + README run steps | LOW | inline | verified | `dev:api`, `dev:web`, `db:migrate` जोड़े; `.env` loading fix (नीचे) |

### Timeline और executor groups

Tracking line 109–117 और change log line 157–164:

| तारीख | घटना |
|---|---|
| 2026-10-23 | Requirement बना और confirm हुआ (4 सवाल) |
| 2026-10-23 | Planner ने plan v1 लिखा; D1–D5 approval के लिए |
| 2026-10-23 | D1–D4 approve; `backend-api.md` rule D1 से aligned |
| 2026-10-23 | Group A (tasks 1–3) लिखा गया, पर Node/npm/Docker न होने से verify नहीं हो सका |
| 2026-10-24 | Node 24 और Docker 29 install; Groups A–E बने और verify हुए |
| 2026-10-24 | Fix: API repo-root `.env` पढ़ने लगा; ESLint में `.cjs` block और `next-env.d.ts` ignore |
| 2026-10-24 | पूरी verification (नीचे); requirement `completed` |
| 2026-10-24 | Commit `f382ca2` |

| Group | Tasks | Executor | क्रम क्यों |
|---|---|---|---|
| A | 1, 2, 3 | executor-low | Root tooling, shared, Compose — बाकी सब इन पर टिके हैं |
| B | 4 | executor-medium | Env + logger — app और server इन्हें use करते हैं |
| C | 5, 6 | executor-high | Security-sensitive core: errors, middleware, app, DB/Redis, server |
| D | 7, 8 | executor-medium | Readiness और integration tests (C पर निर्भर) |
| E | 9 | executor-medium | Web shell (api से स्वतंत्र) |
| F | 10 | inline (main session) | Root scripts + README |

## files

Commit `f382ca2` में 50 files बदलीं (`git show --stat f382ca2`)। मुख्य:

| क्षेत्र | Files |
|---|---|
| Root | `package.json`, `tsconfig.base.json`, `.prettierrc`, `.prettierignore`, `eslint.config.mjs`, `docker-compose.yml`, `.env.example`, `README.md`, `package-lock.json` |
| shared | `shared/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`, `src/schemas/api.ts`, `src/schemas/api.test.ts` |
| api config | `api/package.json`, `tsconfig.json`, `vitest.config.ts`, `.sequelizerc`, `migrations/.gitkeep` |
| api src | `config/{env.ts,env.test.ts,logger.ts,sequelize-cli.cjs}`, `db/{sequelize.ts,redis.ts}`, `errors/app-error.ts`, `middleware/{request-id,request-logger,not-found,error-handler}.ts`, `services/readiness.service.ts`, `routes/health.routes.ts`, `app.ts`, `server.ts` |
| api tests | `tests/integration/app.test.ts`, `tests/integration/readiness-real.test.ts` |
| web | `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `vitest.config.ts`, `next-env.d.ts`, `src/app/{layout.tsx,page.tsx,globals.css,page.test.tsx}` |

> ध्यान दें: इनमें से कुछ files (जैसे `api/src/app.ts`, `api/src/server.ts`, `api/src/config/env.ts`,
> `.env.example`, `api/vitest.config.ts`, `web/src/app/page.test.tsx`) stage-02 में बदली गई हैं (अभी uncommitted)।
> Code walkthrough आज की working copy की line numbers देता है और stage-02 वाली lines को अलग से चिह्नित करता है।

## code walkthrough का link

- [../05-code/01-shared.md](../05-code/01-shared.md)
- [../05-code/02-api-foundation.md](../05-code/02-api-foundation.md)
- [../05-code/05-tests-docker-env.md](../05-code/05-tests-docker-env.md)

## verification (real commands और exit codes)

नीचे के नतीजे tracking (line 77–86, 129, 136, 164) और commit message में दर्ज हैं। **यह doc लिखते समय इन्हें
दोबारा नहीं चलाया गया।**

| Command | दर्ज नतीजा |
|---|---|
| `docker compose config -q` | exit 0 |
| `docker compose up -d` | postgres और redis healthy |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test -w shared` | 10 passed |
| `npm test -w api` | 22 passed, 2 skipped (real-DB file बिना env skip) |
| real-DB file (`readiness-real.test.ts`) env के साथ | 2 passed |
| `npm test -w web` | 2 passed |
| `npm run db:migrate` (+ `db:migrate:status`, `db:migrate:undo`) | exit 0; कोई migration नहीं, इसलिए undo सिर्फ़ no-op |
| `npm run dev:api` → `curl /health`, `curl /ready` | 200 / 200 (बिना inline env, `.env` fix के बाद) |
| `docker compose stop redis` → `/ready` | 503 `redis:down`; `start redis` के बाद 200, बिना API restart |
| Postgres रोका → `/ready` | 503 `postgres:down`; फिर 200 |
| Redis बंद रखकर API start | process exit 1, साफ़ message |
| `npm run build -w web` (बिना env) | exit 0 |
| `npm run dev -w web` | localhost:3000 → 200 |

**जो verify नहीं हुआ / अधूरा रहा** (requirement line 117, tracking line 148–149):
- Success criterion 7 आंशिक: कोई migration नहीं है, तो revert सिर्फ़ no-op के रूप में दिखा।
- SIGINT/SIGTERM graceful shutdown — सिर्फ़ `taskkill /F` से process मारा गया, graceful रास्ता नहीं चला।
- `unhandledRejection` / `uncaughtException` handlers।
- Hang होती dependency पर 1 s readiness timeout।

> आज की स्थिति पर नोट: stage-02 में `api/vitest.config.ts` (line 8) अब `tests/integration/**` को fast suite से
> बाहर रखता है; `app.test.ts` अब `npm run test:integration -w api` में चलता है, जिसके लिए test database चाहिए।
> इसलिए "`npm test -w api` = 22 passed" आँकड़ा foundation commit के समय का है, आज का नहीं।

## issues

### Docker / Node install वाली रुकावट
- **2026-10-23 · HIGH** (tracking line 120–123): machine पर `node`, `npm`, `docker` मिले ही नहीं। Group A की files
  लिखी गईं पर `npm install`, prettier, eslint, `npm test -w shared`, `docker compose config` कुछ नहीं चला। बाकी सब
  groups की verification भी रुकी। हल: developer ने Node.js LTS और Docker Desktop install किए।
- साथ में (line 125–128): root `package.json` में `api`/`web` workspaces थे पर उनकी `package.json` अभी नहीं बनी थी,
  इसलिए `npm install` fail होता — Group B/E के बाद यह ठीक हुआ।
- **2026-10-24 · resolved** (line 129): Node 24 और Docker 29 installed; सारी verification चली।

### `.env` loading का fix
- **2026-10-24 · MEDIUM** (line 133–136): README कहता था `.env.example` को `.env` में copy करो, पर कोई code `.env`
  पढ़ता ही नहीं था। Fix: `api/src/server.ts` (line 15–20) और `api/src/config/sequelize-cli.cjs` (line 4–8) में
  `process.loadEnvFile` — सिर्फ़ तब जब repo-root `.env` मौजूद हो; असली environment variables को प्राथमिकता।
  Verified: `npm run dev:api` बिना inline env के 200/200।

### npm audit (9 issues)
- **2026-10-24 · MEDIUM** (line 130–132): `npm install` ने 9 vulnerabilities बताईं (5 moderate, 2 high,
  2 critical)। **ठीक नहीं की गईं** — `npm audit fix --force` major versions बदलता है और उसके लिए आपकी approval
  चाहिए। Status: **open**; पहली release से पहले फ़ैसला करना है। Commit message भी यही gap बताता है।

### बाकी छोटे issues
- Root `dev` script नहीं: `concurrently` approved नहीं, इसलिए `dev:api` + `dev:web` और दो terminals (line 137–138)।
- Web executor ने ESLint config में `**/next-env.d.ts` ignore और `.cjs` block जोड़ा (line 139–141)।
- Web executor ने एक बार `npx --yes kill-port` चलाया — किसी `package.json` में नहीं (line 142–143)।
- Redis connect पर 10 s cap जोड़ा, क्योंकि Windows dual-stack पर एक hung connection ने startup बिना output रोक दिया
  था (line 144–145)।
- `pino-http` approved नहीं, इसलिए छोटा custom request logger (line 146–147)।
- Socket.IO adapter का दूसरा Redis client जानबूझकर realtime phase तक टाला (line 150–151)।

## commits

`git log --oneline` (इस doc को लिखते समय चलाया):

```
f382ca2 Add project foundation: monorepo, API core, health checks, web shell
708abec Add product docs and plain-English Claude workflow guide
e5dce2d added initial claude workflows
```

- `708abec` — docs commit: `docs/01`–`docs/13`, `docs/claude-workflow/`, और `backend-api.md` rule का envelope
  docs/04 से aligned। (यह foundation से पहले का है, Phase 1 का हिस्सा।)
- `f382ca2` — foundation commit: 50 files, 9778 insertions। Message में tests गिनती (shared 10, api 22 + 2 real-DB,
  web 2) और known gaps (SIGINT/SIGTERM, 1 s timeout, npm audit) दर्ज हैं।

## अगले कदम

1. **D5** (open): `docs/02` §5 और `docs/09` से `REDIS_REQUIRED` हटाना (सिर्फ़ doc)।
2. **npm audit**: 9 advisories की समीक्षा, major upgrades पर फ़ैसला (approval चाहिए)।
3. **अधूरी verification**: SIGINT/SIGTERM shutdown, unhandled handlers, 1 s readiness timeout — इनके लिए test या
   manual check।
4. Migration revert का असली test — stage-02 की पहली migration के साथ (`sessions-and-join` tracking task 3 में
   up/down/up दर्ज है)।
5. अगला stage: [stage-02 `sessions-and-join`](./stage-02-sessions-and-join.md) — completed पर अभी commit बाकी।
