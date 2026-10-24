# `api/` foundation files — code walkthrough

इस doc में backend (Express + TypeScript) की वे files हैं जो foundation stage (commit `f382ca2`) में बनीं। हर file
के लिए: **उद्देश्य**, मुख्य code blocks का line-by-line विवरण, और **कैसे test/verify हुआ**।

- Line numbers आज की working copy के हैं।
- जो lines stage-02 (`sessions-and-join`, अभी uncommitted) में जुड़ीं, उन्हें **[stage-02]** से चिह्नित किया है।
  (`git diff HEAD` से पुष्टि की।)
- "Tracking" = `requirements/foundation/planning-tracking.md`।

---

## 1. `api/package.json`

**उद्देश्य:** api workspace के scripts और dependencies।

### Scripts (line 6–16)

| Line | Script | Command | मतलब |
|---|---|---|---|
| 7 | `dev` | `tsx watch src/server.ts` | `tsx` TypeScript को बिना build सीधे चलाता है; `watch` file बदलने पर restart करता है। Development के लिए |
| 8 | `start` | `tsx src/server.ts` | वही, बिना watch। अभी कोई compile/build step नहीं (plan decision 5) |
| 9 | `typecheck` | `tsc --noEmit` | सिर्फ़ type जाँच; JS output नहीं |
| 10 | `test` | `vitest run` | Fast unit suite (`vitest.config.ts`), एक बार |
| 11 | `test:integration` | `vitest run --config vitest.integration.config.ts` | **[stage-02]** Integration suite — test database चाहिए |
| 12 | `db:migrate` | `sequelize-cli db:migrate` | बाकी migrations लागू करता है; पहली बार `SequelizeMeta` table बनती है |
| 13 | `db:migration:generate` | `sequelize-cli migration:generate --name` | **[stage-02]** नई migration file generate करता है (नाम आगे देना होता है) |
| 14 | `db:migrate:status` | `sequelize-cli db:migrate:status` | कौन सी migration लगी/बाकी है |
| 15 | `db:migrate:undo` | `sequelize-cli db:migrate:undo` | आख़िरी migration revert |

### Dependencies (line 17–40)
- Runtime (line 18–28): `@livepulse/shared`, `@socket.io/redis-adapter` (अभी use नहीं), `cors`, `express` (v5, D3),
  `helmet`, `pg` (Postgres driver), `pino` (logger), `redis`, `sequelize`, `socket.io` (installed, wired नहीं), `zod`।
- Dev (line 30–39): `@types/*` (D2), `sequelize-cli`, `supertest`, `tsx`, `typescript`, `vitest`।

**कैसे verify हुआ:** tracking task 6 — `db:migrate`, `db:migrate:status`, `db:migrate:undo` OK; task 10 — root
`db:migrate` exit 0 (line 164)।

---

## 2. `api/tsconfig.json`

| Line | Code | मतलब |
|---|---|---|
| 2 | `"extends": "../tsconfig.base.json"` | Root strict settings (`strict`, `NodeNext`, `noUncheckedIndexedAccess`) |
| 4 | `"noEmit": true` | `tsc` कभी JS file नहीं लिखता — runtime पर `tsx` चलता है |
| 6 | `"include": ["src", "tests"]` | Tests भी type-check होते हैं |

**Verify:** `npm run typecheck` exit 0 (tracking line 164)।

---

## 3. `api/vitest.config.ts`

| Line | Code | मतलब |
|---|---|---|
| 3 | comment | **[stage-02]** Fast suite: कोई database नहीं; integration अलग config से |
| 6 | `environment: 'node'` | Node environment |
| 7 | `include: ['tests/**/*.test.ts', 'src/**/*.test.ts']` | Colocated unit tests (`src/config/env.test.ts`) और `tests/` |
| 8 | `exclude: ['tests/integration/**', '**/node_modules/**']` | **[stage-02]** Integration tests fast suite से बाहर |

> Foundation के समय line 8 नहीं थी, इसलिए `npm test -w api` में `tests/integration/app.test.ts` भी चलता था
> (22 passed, 2 skipped)। अब वह `test:integration` में चलता है। Integration config (`api/vitest.integration.config.ts`)
> का विवरण `05-tests-docker-env.md` में है।

---

## 4. `api/.sequelizerc`

**उद्देश्य:** `sequelize-cli` को बताना कि config और migrations कहाँ हैं।

| Line | Code | मतलब |
|---|---|---|
| 1 | `const path = require('path')` | CommonJS — sequelize-cli इस file को `require` से पढ़ता है |
| 4 | `config: path.resolve(__dirname, 'src', 'config', 'sequelize-cli.cjs')` | DB config file का path |
| 5 | `'migrations-path': path.resolve(__dirname, 'migrations')` | Migrations folder `api/migrations/` |

क्यों `.cjs` config: plan decision 4 — migrations `.cjs` हैं ताकि sequelize-cli को ts-node न चाहिए।

---

## 5. `api/src/config/env.ts` — environment validation (जाँच)

**उद्देश्य:** process start होते ही सभी settings को Zod से जाँचना। कुछ भी गलत हो तो **fail fast** (तुरंत रुक जाना) —
requirement behaviour 2।

### `isHttpOrigin` (line 3–10)
- Line 5: `new URL(value)` — string को URL की तरह parse करता है; invalid हो तो exception।
- Line 6: सिर्फ़ `http:` या `https:` protocol मान्य।
- Line 7–8: parse fail → `false` (exception निगलना नहीं, बल्कि साफ़ "नहीं" लौटाना)।

### `envSchema` — हर key (line 12–37)

| Line | Key | नियम | Default | क्यों |
|---|---|---|---|---|
| 13 | `NODE_ENV` | `development` / `test` / `production` में से एक | `development` | गलत spelling (जैसे `prod`) पकड़ता है |
| 14 | `PORT` | `z.coerce.number().int().min(1).max(65535)` | `4000` | Env values हमेशा string होती हैं; `coerce` उन्हें number बनाता है; valid port range |
| 15–23 | `WEB_ORIGIN` | Comma से split → trim → खाली हटाओ → हर एक http(s) origin, कम-से-कम 1 | — (ज़रूरी) | CORS allowlist; कई origins दे सकते हैं (जैसे `http://localhost:3000, https://app.example.com`)। `.pipe(...)` transform के बाद array को दोबारा validate करता है |
| 24 | `DATABASE_URL` | `postgres://` या `postgresql://` से शुरू | — (ज़रूरी) | गलत DB (जैसे `mysql://`) पर start नहीं |
| 25–29 | `TEST_DATABASE_URL` | Postgres URL, optional | — | **[stage-02]** सिर्फ़ integration suite पढ़ता है |
| 30 | `REDIS_URL` | `redis://` या `rediss://` (TLS) | — (ज़रूरी) | Redis required है (clarification जवाब 2) |
| 31–35 | `TRUST_PROXY` | `'true'`/`'false'` → boolean | `false` | **[stage-02]** reverse proxy के पीछे ही `true` |
| 36 | `LOG_LEVEL` | pino levels में से एक | `info` | — |

- Line 39: `export type Env = z.infer<typeof envSchema>` — validated env का type (transforms के बाद, जैसे
  `WEB_ORIGIN` अब `string[]` और `PORT` number)।

### `loadEnv` और fail-fast (line 41–48)
- Line 41: `source` default `process.env`; tests अपना object दे सकते हैं।
- Line 42: `safeParse` — exception नहीं फेंकता, `{ success, data | error }` लौटाता है।
- Line 44: हर issue का `path[0]` (top-level key का नाम) लेकर `Set` से duplicate हटाता है।
- Line 45: `Invalid environment configuration: PORT, DATABASE_URL` जैसा message — **सिर्फ़ key names**।

**Error message में value क्यों नहीं?** `DATABASE_URL` में username और password होता है
(`postgres://user:password@host/db`)। Zod के default issue messages या `result.error` पूरा print करने से value log
में जा सकती है। Logs अक्सर दूसरे systems में जाते हैं, इसलिए secret leak होगा। Requirement behaviour 2 साफ़ कहता है:
"names the missing setting, never prints its value"।

**कैसे test हुआ** — `api/src/config/env.test.ts` (आज 10 tests; foundation में 8, बाकी 2 [stage-02]):
- line 11–16: defaults (`development`, `4000`, `info`)।
- line 18–22: `DATABASE_URL` missing → exact message `Invalid environment configuration: DATABASE_URL`।
- line 24–34: गलत scheme (`mysql://`, `http://` for Redis) और port `70000` reject।
- line 36–46: कई origins स्वीकार; `ftp://` reject।
- line 48–61: **[stage-02]** `TRUST_PROXY` और `TEST_DATABASE_URL`।
- line 63–73: सबसे अहम — message `PORT, DATABASE_URL` बताता है पर `secret-pass` और `abc` (values) नहीं।

---

## 6. `api/src/config/logger.ts` — pino logger

**उद्देश्य:** JSON structured logs (हर log एक JSON object) बनाना और संवेदनशील fields छिपाना।

| Line | Code | मतलब / क्यों |
|---|---|---|
| 3 | `createLogger = (env: { LOG_LEVEL: string; NODE_ENV: string })` | Factory; पूरा `Env` नहीं, सिर्फ़ ज़रूरी fields — ताकि `server.ts` invalid env पर भी fallback logger बना सके। `NODE_ENV` type में है पर function body में use नहीं होता |
| 5 | `level: env.LOG_LEVEL` | कितने detail तक log |
| 6 | `base: {}` | pino default में `pid` और `hostname` जोड़ता है; खाली `base` उन्हें हटाता है — host details logs में नहीं |
| 7–14 | `redact: [...]` | इन paths की value log में `[Redacted]` से बदल जाती है |

**Redact paths:**
- line 8 `req.headers.authorization` — auth token।
- line 9 `req.headers.cookie` — session cookies।
- line 10 `req.headers['x-participant-token']` — participant का token (plan decision 7)।
- line 11–13 `*.password`, `*.token`, `*.presenterKey` — किसी भी object के अंदर (एक level गहराई तक `*` wildcard)
  ये keys।

यह "defence in depth" (दोहरी सुरक्षा) है: request logger वैसे भी headers log नहीं करता (नीचे), फिर भी अगर कोई गलती से
`req` log कर दे तो secrets छिपे रहें।

**Verify:** env/logger task 4 में 8 env tests; redaction के लिए अलग test नहीं मिला (पुष्टि नहीं हुई)।

---

## 7. `api/src/config/sequelize-cli.cjs`

**उद्देश्य:** `sequelize-cli` (migrations) के लिए DB config।

| Line | Code | मतलब |
|---|---|---|
| 1–2 | `require('node:fs')`, `require('node:path')` | CommonJS (sequelize-cli `require` से load करता है) |
| 5 | `join(__dirname, '..', '..', '..', '.env')` | `api/src/config/` से तीन level ऊपर = repo root का `.env` |
| 6–8 | `if (existsSync(...)) process.loadEnvFile(...)` | `.env` हो तभी पढ़ो। Node का `process.loadEnvFile` पहले से set variables को नहीं बदलता — इसलिए असली env जीतता है (comment line 4) |
| 10–14 | `DATABASE_URL` न हो तो `throw` | Migration गलत/खाली DB पर न चले। Message में सिर्फ़ नाम |
| 16 | `{ url, dialect: 'postgres' }` | Config |
| 18 | `development`, `test`, `production` तीनों एक ही config | DB कौन सा है, यह सिर्फ़ `DATABASE_URL` से तय होता है |

**इतिहास:** line 4–8 `.env` loading fix का हिस्सा है (tracking line 133–136)।
**Verify:** `npm run db:migrate` exit 0; status/undo OK (task 6)।

---

## 8. `api/src/errors/app-error.ts`

**उद्देश्य:** services/routes के लिए typed error class, जिसे error handler पहचानकर सही HTTP status देता है।

| Line | Code | मतलब |
|---|---|---|
| 1 | `class AppError extends Error` | सामान्य `Error` का विस्तार |
| 2–4 | `readonly status`, `code`, `details?` | HTTP status (जैसे 503), machine code (`NOT_READY`), optional details |
| 11 | `options?: { cause?: unknown }` | मूल error को `cause` में रख सकते हैं (error निगलना नहीं) |
| 13 | `super(message, options)` | Standard `Error` constructor |
| 14 | `this.name = 'AppError'` | Logs में पहचान |

**Use:** `health.routes.ts` line 23 में `new AppError(503, 'NOT_READY', 'Service not ready', details)`।

---

## 9. `api/src/middleware/request-id.ts`

**उद्देश्य:** हर request को एक ID देना जो response header, error body और logs में दिखे (plan decision 6)।

| Line | Code | मतलब / क्यों |
|---|---|---|
| 4 | `REQUEST_ID_PATTERN = /^[\w-]{1,64}$/` | सिर्फ़ letters, digits, `_`, `-`; 1–64 characters — header में अजीब characters या बहुत लंबी string न आ सके |
| 6–9 | `getRequestId(res)` | `res.locals.requestId` पढ़ता है; string न हो तो `'unknown'` — type-safe तरीक़ा (`unknown` से जाँच) |
| 12 | `req.get('x-request-id')` | Client/proxy का भेजा ID |
| 13 | Pattern match हो तो वही, वरना `randomUUID()` | Spoofed (नकली) या बहुत लंबा ID log injection या बड़े logs न बना सके |
| 14 | `res.locals.requestId = id` | बाकी middleware के लिए |
| 15 | `res.setHeader('X-Request-Id', id)` | Client को लौटाया — support में मिलान के लिए |

**Test:** `api/tests/integration/app.test.ts` line 124–145 — valid ID echo होता है; space वाला और 100-char ID UUID से
बदलता है।

---

## 10. `api/src/middleware/request-logger.ts`

**उद्देश्य:** हर request पूरी होने पर एक log line। `pino-http` approved नहीं था, इसलिए छोटा custom middleware
(tracking line 146–147)।

| Line | Code | मतलब |
|---|---|---|
| 5 | comment | सिर्फ़ method, path, status, duration, request id — **headers या body कभी नहीं** |
| 9 | `process.hrtime.bigint()` | High-resolution समय (nanoseconds) |
| 10 | `res.on('finish', ...)` | Response भेजे जाने के बाद log — तब status code पता होता है |
| 11 | `/ 1e6` | Nanoseconds → milliseconds |
| 14–18 | log fields | `req.path` (query string नहीं — query में भी कभी token हो सकता है); duration एक decimal तक |
| 23 | `next()` | Request आगे बढ़ाओ |

**Verify:** अलग unit test नहीं; live run में logs देखे गए या नहीं — (पुष्टि नहीं हुई)।

---

## 11. `api/src/middleware/not-found.ts`

| Line | Code | मतलब |
|---|---|---|
| 4 | `notFound = (_req, res)` | किसी route ने match नहीं किया तो यह चलता है |
| 5–8 | `404` + `{ success: false, error: { code: 'NOT_FOUND', message: 'Route not found', requestId } }` | D1 envelope; request ID के साथ |

**Test:** `app.test.ts` line 75–84 — `/nope` → 404, `NOT_FOUND`, requestId string, कोई `stack` नहीं।

---

## 12. `api/src/middleware/error-handler.ts`

**उद्देश्य:** सभी errors को एक जगह D1 envelope में बदलना; client को कभी stack trace या DB details नहीं (behaviour 6)।

| Line | Code | मतलब / क्यों |
|---|---|---|
| 6 | `type ErrorBody` | `code`, `message`, optional `details` |
| 9–12 | `bodyParserType(err)` | `express.json()` के errors में `type` string होता है; यह function बिना shape पर भरोसा किए (`unknown` + checks) उसे पढ़ता है |
| 14 | `createErrorHandler(logger)` | Factory, ताकि logger inject हो |
| 15–17 | `(err, req, res, _next)` + eslint-disable | Express error middleware को **4 arguments** से पहचानता है, इसलिए `_next` use न होने पर भी रहना चाहिए |
| 18 | `getRequestId(res)` | Request ID पहले से set है क्योंकि `requestId` middleware सबसे पहले चलता है |
| 23–25 | `entity.parse.failed` → 400 `VALIDATION_ERROR` | खराब JSON (plan decision 7) |
| 26–28 | `entity.too.large` → 413 `PAYLOAD_TOO_LARGE` | Body 100 kb से बड़ी |
| 29–32 | `AppError` → उसका status/code/message; `details` तभी जब defined | Services के intentional errors |
| 33–36 | बाकी सब → 500 `INTERNAL_ERROR`, generic message | असली error सिर्फ़ server log में (requestId के साथ), client को नहीं |
| 39 | `res.status(status).json({ success: false, error: { ...body, requestId } })` | हमेशा एक ही shape |

**Express 5 का फ़ायदा:** async route में `throw` (जैसे `/ready` में) अपने-आप इस handler तक पहुँचता है।

**Test:** `app.test.ts` line 86–108 (400, 413), line 55–64 (503 `NOT_READY` + details + requestId = header), line
110–121 (किसी error में `stack` शब्द नहीं)। 500 वाला रास्ता (unhandled error) tracking के अनुसार exercise नहीं हुआ
(task 5 note)।

---

## 13. `api/src/app.ts` — `createApp(deps)` और middleware का क्रम

**उद्देश्य:** Express app बनाना, बिना `listen` किए। Dependencies (logger, readiness आदि) बाहर से आती हैं — plan
decision 1, ताकि Supertest बिना Docker के app test कर सके।

### `AppDeps` (line 16–22)
- line 17: `env` — अब `Pick<Env, 'NODE_ENV' | 'WEB_ORIGIN' | 'TRUST_PROXY'>` **[stage-02]**; foundation में पूरा `Env` था।
- line 18–19: `logger`, `readiness` (foundation)।
- line 20–21: `sequelize`, `models` **[stage-02]**।

### Middleware का क्रम (line 24–52) और क्यों

| क्रम | Line | Code | यह इस जगह क्यों |
|---|---|---|---|
| — | 26 | `app.disable('x-powered-by')` | `X-Powered-By: Express` header हटाता है — framework की जानकारी नहीं (behaviour 4 की भावना) |
| — | 28 | `app.set('trust proxy', env.TRUST_PROXY)` | **[stage-02]** |
| 1 | 30 | `requestId` | **सबसे पहले**, ताकि हर बाद वाला middleware, हर log और हर error (JSON parse error भी) के पास ID हो |
| 2 | 31 | `createRequestLogger(logger)` | ID के बाद, पर बाकी सबसे पहले — `finish` पर log होता है, इसलिए 404/400/500 वाले requests भी log होते हैं |
| 3 | 32 | `helmet()` | Security headers (जैसे `X-Content-Type-Options`), error responses समेत हर response पर |
| 4 | 34 | `cors({ origin: env.WEB_ORIGIN, credentials: true })` | Routes से पहले, ताकि preflight `OPTIONS` का जवाब मिले। Origin सिर्फ़ explicit list, कभी `*` नहीं। Foundation में `credentials: false` था; stage-02 में cookies के कारण `true` **[stage-02]** |
| 5 | 35 | `express.json({ limit: '100kb' })` | Body parse; 100 kb limit (decision 7)। Parse/size errors error handler तक जाते हैं जिसके पास पहले से requestId है |
| 6 | 38 | `createHealthRouter(readiness)` | Ops endpoints root पर (`/health`, `/ready`), `/api` के नीचे नहीं (comment line 37) |
| 7 | 39–48 | `'/api'` sessions router | **[stage-02]** |
| 8 | 50 | `notFound` | सभी routes के **बाद** — कोई match न हुआ तभी पहुँचता है |
| 9 | 51 | `createErrorHandler(logger)` | **सबसे आख़िर** — Express में error middleware उन routes के बाद register होना चाहिए जिनके errors उसे पकड़ने हैं |

**Test:** `app.test.ts` पूरी file `createApp` पर चलती है — CORS (line 147–176: allowed origin, अनजान origin को
header नहीं, कभी `*` नहीं), 404/400/413, request id। Tracking task 5: verified (partial)।

---

## 14. `api/src/db/sequelize.ts`

| Line | Code | मतलब / क्यों |
|---|---|---|
| 4–5 | `createSequelize(databaseUrl, logger)` → `new Sequelize(databaseUrl, {...})` | Connection object बनाता है; **connect नहीं करता** (Sequelize lazy है) — इसलिए Postgres बंद हो तब भी API start होता है (decision 3) |
| 6 | `dialect: 'postgres'` | — |
| 7–8 | `logging: (sql) => logger.debug({ sql }, ...)` | SQL सिर्फ़ debug level पर; connection URL कभी log नहीं |
| 9 | `pool: { max: 10, min: 0, idle: 10000 }` | अधिकतम 10 connections; 10 s idle के बाद connection बंद |
| 10 | `define: { underscored: true }` | Models के columns `snake_case` में (project convention) |
| 13–15 | `closeSequelize` | Shutdown में pool बंद |

---

## 15. `api/src/db/redis.ts` — fail fast, reconnect strategy, 10 s timeout

**उद्देश्य:** Redis client बनाना जो **startup पर** न मिले तो जल्दी हार मान ले (decision 2), पर एक बार connect होने के
बाद हमेशा reconnect करता रहे ताकि `/ready` बिना restart recover करे।

### Constants (line 4–8)
- line 4 `REDIS_STARTUP_ERROR = 'Redis is unreachable at startup'` — एक तय message (URL नहीं)।
- line 6 `STARTUP_MAX_ATTEMPTS = 3`, line 7 `MAX_BACKOFF_MS = 5000`, line 8 `STARTUP_TIMEOUT_MS = 10_000`।

### `describeError` (line 10–15)
Error का सिर्फ़ message या `code` (जैसे `ECONNREFUSED`) — कभी URL नहीं। Comment line 10: dual-stack (IPv4 + IPv6)
`AggregateError` का message खाली होता है, इसलिए `code` fallback।

### Reconnect strategy (line 25–36)
- line 25: `hasConnected = false` — अभी तक कभी connect हुए या नहीं।
- line 31: `reconnectStrategy: (retries) => ...` — `retries` = अब तक की failed attempts (0 से शुरू)।
- line 32: अगर **कभी connect नहीं हुए** और `retries + 1 >= 3` → `Error` लौटाओ = retry बंद (fail fast)। यानी
  startup पर 3 failed attempts के बाद हार।
- line 33: वरना exponential backoff: `2^retries × 100 ms` (100, 200, 400, …), अधिकतम 5000 ms। एक बार connect होने
  के बाद line 32 कभी true नहीं होगी, तो हमेशा retry।
- line 38–40: `'ready'` event पर `hasConnected = true`।
- line 42–44: `'error'` listener **ज़रूरी** है — Node में बिना listener का `error` event process crash करता है।
  सिर्फ़ `describeError` log (error object में credentials वाला URL हो सकता है — comment line 41)।

### `connect()` और 10 s timeout (line 48–66)
- line 49 comment: कोई TCP listener जो handshake का जवाब ही न दे (जैसे Windows पर stale port relay) तो
  `client.connect()` हमेशा के लिए अटक सकता है।
- line 51–53: 10 s बाद reject होने वाला `timeout` promise।
- line 55: `Promise.race([client.connect(), timeout])` — जो पहले ख़त्म हो।
- line 56–62: fail पर client खुला हो तो disconnect (cleanup error भी log, निगलना नहीं), फिर
  `new Error(REDIS_STARTUP_ERROR, { cause: err })` — मूल कारण `cause` में।
- line 63–65: `finally` में `clearTimeout` — timer process को ज़िंदा न रखे।
- line 67–69: `disconnect()` — खुला हो तो `quit()` (pending commands पूरे करके बंद)।

**इतिहास:** 10 s cap tracking line 144–145 के बाद जोड़ा गया (hung connection ने startup बिना output रोक दिया था)।
Line 23 comment: Socket.IO adapter के pub/sub clients realtime phase में।

**Verify:** Redis बंद रखकर API start → exit 1 (task 6); Redis बीच में रोका → `/ready` 503, फिर start → 200 बिना
restart (task 7)।

---

## 16. `api/src/services/readiness.service.ts` — 1 s timeout, `Promise.race`

**उद्देश्य:** PostgreSQL और Redis को एक साथ probe करना और `up`/`down` बताना।

| Line | Code | मतलब / क्यों |
|---|---|---|
| 3–7 | `DependencyStatus`, `ReadinessReport`, `ReadinessChecker` | Types; `ReadinessChecker` एक interface है जिसे tests fake कर सकते हैं |
| 10–14 | `ReadinessDeps` structural types | सिर्फ़ `query(sql)` और `ping()` चाहिए — असली Sequelize/redis client भी fit, fake भी (comment line 9) |
| 16 | `CHECK_TIMEOUT_MS = 1000` | हर check अधिकतम 1 s (decision 3) |
| 19–23 | `describeError` | सिर्फ़ `code` या `name` — driver messages में URL हो सकता है |
| 26 | `probe(name, run)` | एक dependency का check |
| 28–30 | 1 s बाद reject होने वाला timeout | Hang होती dependency `/ready` को अटका न सके |
| 32 | `Promise.race([run(), timeout])` | जो पहले हो — जवाब या timeout |
| 33 | `'up'` | — |
| 34–36 | catch → warn log (dependency + reason) → `'down'` | Exception नहीं फेंकता; status लौटाता है |
| 37–39 | `finally { clearTimeout(timer) }` | Timer leak नहीं |
| 44–47 | `Promise.all([...])` | दोनों checks **parallel** — कुल समय ~1 s से ज़्यादा नहीं |
| 45 | `sequelize.query('SELECT 1')` | Postgres का सबसे सस्ता check |
| 46 | `redis.ping()` | Redis `PONG` |

**Verify:** `api/tests/integration/readiness-real.test.ts` (असली services पर, 2 tests: दोनों up; बंद connection →
`postgres: 'down'` बिना throw)। Live outage task 7 में। **1 s timeout का hang वाला case verify नहीं हुआ** (tracking
line 148–149)।

---

## 17. `api/src/routes/health.routes.ts`

| Line | Code | मतलब |
|---|---|---|
| 2 | `import type { HealthData, NotReadyDetails, ReadyData } from '@livepulse/shared'` | Shared contract के types — response shape compile time पर जाँचा जाता है |
| 9–13 | `GET /health` → `{ success: true, data: { status: 'ok' } }` | **Liveness**: process ज़िंदा है। जानबूझकर कोई dependency check नहीं (comment line 9) — वरना Redis गिरने पर orchestrator स्वस्थ process को भी restart कर देगा |
| 15–16 | `GET /ready` async → `readiness.check()` | **Readiness**: क्या traffic serve कर सकते हैं |
| 17–21 | दोनों `up` → 200 `{ status: 'ready', checks }` | — |
| 22–23 | वरना `throw new AppError(503, 'NOT_READY', 'Service not ready', details)` | Express 5 इसे error handler तक भेजता है → D1 envelope + requestId। Details में सिर्फ़ `up`/`down`, कोई host नहीं |

**Test:** `app.test.ts` line 35–72 — `/health` dependencies down होने पर भी 200; `/ready` 200, Redis down → 503,
Postgres down → 503।

---

## 18. `api/src/server.ts` — startup order, `loadEnvFile`, graceful shutdown

**उद्देश्य:** असली process का entry point: env पढ़ना, logger, connections, app को `listen`, और shutdown संभालना।

### `.env` loading (line 13–20)
- line 13: `SHUTDOWN_TIMEOUT_MS = 10_000`।
- line 17: `join(import.meta.dirname, '..', '..', '.env')` — `api/src/` से दो level ऊपर = repo root।
- line 18–20: file हो तो `process.loadEnvFile` — पहले से set real env variables नहीं बदलते; production में file
  नहीं, variables सीधे set (comment line 15–16)। यह `.env` fix का हिस्सा है (tracking line 133–136)।

### `readEnv` (line 22–32)
- `loadEnv` fail हो तो असली logger नहीं बन सकता (वह env पर निर्भर है), इसलिए line 27 पर fixed settings वाला fallback
  logger `fatal` level पर सिर्फ़ message (key names, value नहीं) लिखता है, फिर line 30 `process.exit(1)`।

### `registerProcessHandlers` (line 34–43)
- `unhandledRejection` और `uncaughtException` → fatal log → `exit(1)`। अनजान state में चलते रहने से बेहतर है बंद
  होना। **Verify नहीं हुआ** (tracking line 148)।

### Startup order — `main()` (line 45–66)

| क्रम | Line | कदम | क्यों इस क्रम में |
|---|---|---|---|
| 1 | 46 | `readEnv()` | सब कुछ env पर निर्भर; गलत हो तो तुरंत exit |
| 2 | 47 | `createLogger(env)` | अब असली logger |
| 3 | 48 | `registerProcessHandlers(logger)` | आगे के async काम में कोई unhandled error log हो सके |
| 4 | 51 | `createSequelize(...)` | Object बनता है, connect नहीं — Postgres startup पर fatal नहीं (comment line 50, decision 3) |
| 5 | 52 | `createRedisClients(...)` | — |
| 6 | 54–59 | `await redis.connect()`; fail → fatal `REDIS_STARTUP_ERROR` → `exit(1)` | Requirement behaviour 3: Redis के बिना start नहीं। Catch में `cause` log नहीं होता — सिर्फ़ तय message |
| 7 | 61 | `createReadinessChecker(...)` | — |
| 8 | 62 | `initModels(sequelize)` | **[stage-02]** |
| 9 | 63 | `createApp(...)` | — |
| 10 | 64–66 | `app.listen(env.PORT)` | सब तैयार होने के **बाद** ही port खुलता है |

### Graceful shutdown (line 68–94)
- line 68–71: `shuttingDown` flag — दो बार signal आने पर दो बार shutdown नहीं।
- line 73–76: 10 s का safety timer → `exit(1)`; `.unref()` ताकि यह timer अकेले process को ज़िंदा न रखे।
- line 78: `server.close(...)` — नए connections बंद, चल रहे requests पूरे होने दो।
- line 79: `Promise.allSettled([closeSequelize, redis.disconnect()])` — दोनों बंद करने की कोशिश; एक fail हो तो भी
  दूसरा बंद हो।
- line 81–83: rejected results log; line 84 `exit(0)`।
- line 86–89: अनपेक्षित error → log → `exit(1)`।
- line 93–94: `SIGINT` (Ctrl+C) और `SIGTERM` (Docker/orchestrator का stop signal) पर `shutdown`।
- line 97: `void main()` — promise जानबूझकर await नहीं (top-level); errors process handlers पकड़ते हैं।

**Verify:** Redis-down startup → exit 1 (task 6); `npm run dev:api` → 200/200। **SIGINT/SIGTERM graceful shutdown
verify नहीं हुआ** — सिर्फ़ `taskkill /F` (force kill) से process बंद किया गया, जो graceful रास्ता नहीं चलाता (tracking
line 148)।
