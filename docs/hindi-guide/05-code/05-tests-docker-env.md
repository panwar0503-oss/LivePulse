# Tests, Docker, env और tooling — walkthrough

इस doc में foundation stage का infrastructure (बुनियादी ढाँचा) है: Docker Compose, `.env.example`, tests, Vitest
configs, root scripts, ESLint और Prettier। Line numbers आज की working copy के हैं; stage-02 में जुड़ी lines
**[stage-02]** से चिह्नित हैं।

---

## 1. `docker-compose.yml`

**उद्देश्य:** एक command (`docker compose up -d`) से local PostgreSQL और Redis चलाना (requirement behaviour 1)।

### `postgres` service (line 2–15)

| Line | Code | मतलब / क्यों |
|---|---|---|
| 3 | `image: pgvector/pgvector:pg16` | PostgreSQL 16 जिसमें pgvector extension पहले से है। AI phase (9+) में vectors PostgreSQL में ही रहेंगे — अलग vector DB नहीं। Extension अभी create नहीं होता, सिर्फ़ image (plan decision 4) |
| 4–7 | `POSTGRES_USER/PASSWORD/DB: ${...}` | Values hard-code नहीं; Compose इन्हें repo-root `.env` से भरता है (Compose का default व्यवहार) |
| 8–9 | `'5432:5432'` | Host का port 5432 → container। Windows पर पहले से Postgres चल रहा हो तो clash (README note, plan edge case) |
| 10–11 | `pgdata:/var/lib/postgresql/data` | Named volume — container हटे/restart हो तब भी data बचे |
| 12–15 | healthcheck: `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`, हर 5 s, 10 retries | DB connections लेने को तैयार है या नहीं; `docker compose ps` में `healthy` दिखता है |

### `redis` service (line 17–24)

| Line | Code | मतलब |
|---|---|---|
| 18 | `image: redis:7` | Redis 7 |
| 19–20 | `'6379:6379'` | Host port |
| 21–24 | healthcheck: `redis-cli ping`, हर 5 s, 10 retries | `PONG` मिले तो healthy |

Redis का कोई volume नहीं — वह source of truth नहीं है (CLAUDE.md: PostgreSQL source of truth, Redis Pub/Sub
durable नहीं)।

### `volumes` (line 26–27)
`pgdata:` — named volume की घोषणा।

**Verify:** tracking task 3 — `docker compose config -q` exit 0; `docker compose up -d` → दोनों healthy। Outage test
में `docker compose stop redis` / `start redis` use हुआ (task 7)।

---

## 2. `.env.example`

**उद्देश्य:** कौन-कौन सी settings चाहिए, यह दिखाना — **सिर्फ़ placeholders** (नमूना values), कोई असली secret नहीं।
Developer इसे `.env` में copy करके अपनी values भरता है। `.env` gitignored है।

| Line | Key | मतलब |
|---|---|---|
| 1 | `NODE_ENV=development` | Mode |
| 2 | `PORT=4000` | API का port |
| 3 | `WEB_ORIGIN=http://localhost:3000` | CORS allowlist (comma से कई) |
| 4 | `DATABASE_URL=postgres://livepulse:change_me@localhost:5432/livepulse` | App का DB; `change_me` placeholder password |
| 5–6 | `TEST_DATABASE_URL=...livepulse_test` | **[stage-02]** सिर्फ़ integration tests; नाम `_test` पर ख़त्म होना ज़रूरी |
| 7 | `REDIS_URL=redis://localhost:6379` | Redis |
| 8 | `LOG_LEVEL=debug` | Local में ज़्यादा detail (code default `info` है — `env.ts` line 36) |
| 9 | `TRUST_PROXY=false` | **[stage-02]** |
| 10–12 | `POSTGRES_USER`, `POSTGRES_PASSWORD=change_me`, `POSTGRES_DB` | Docker Compose इन्हीं से Postgres container बनाता है; `DATABASE_URL` की values से मेल खानी चाहिए |

`.env` कैसे पढ़ी जाती है: `api/src/server.ts` line 17–20 और `api/src/config/sequelize-cli.cjs` line 5–8 (देखें
`02-api-foundation.md`)।

---

## 3. `api/tests/integration/app.test.ts`

**उद्देश्य:** पूरे Express app (`createApp`) का behaviour Supertest से जाँचना — बिना असली Postgres/Redis। Readiness
को fake किया जाता है (plan decision 1)।

### Setup (line 1–33)
- line 11–19: एक fixed `env` object (`LOG_LEVEL: 'fatal'`; line 17 `TRUST_PROXY` **[stage-02]**)।
- line 21–26: **[stage-02]** एक Sequelize जो कभी connect नहीं होता (port 1) + `initModels` — क्योंकि अब `createApp`
  को `sequelize` और `models` चाहिए; ये tests session routes तक नहीं पहुँचते।
- line 28: UUID regex।
- line 30–33: `buildApp(postgres, redis)` — fake `ReadinessChecker` जो दिए गए status लौटाता है; logger `silent`।

### Tests (कुल 14)

| Lines | Group | क्या जाँचता है |
|---|---|---|
| 35–42 | health | दोनों dependencies down होने पर भी `/health` 200 और body बिल्कुल `{ success: true, data: { status: 'ok' } }` (कोई extra field नहीं) |
| 45–53 | readiness | दोनों up → 200 ready |
| 55–64 | readiness | Redis down → 503, `NOT_READY`, `Service not ready`, details `{ postgres: 'up', redis: 'down' }`, body का requestId = header |
| 66–71 | readiness | Postgres down → 503 |
| 75–84 | errors | `/nope` → 404 `NOT_FOUND`, requestId, कोई `stack` नहीं |
| 86–96 | errors | खराब JSON → 400 `VALIDATION_ERROR` |
| 98–108 | errors | 101 KB body → 413 `PAYLOAD_TOO_LARGE` |
| 110–121 | errors | 503/404/400 किसी में `stack` शब्द नहीं |
| 125–130 | request id | Valid ID echo (header + body) |
| 132–137 | request id | Space वाला ID → UUID |
| 139–144 | request id | 100 characters → UUID |
| 148–152 | CORS | Configured origin को allow header |
| 154–158 | CORS | `http://evil.example` को कोई allow header नहीं |
| 160–175 | CORS | किसी भी case (preflight समेत) में `*` नहीं |

### कब चलता है
- Foundation में: `npm test -w api` के अंदर (22 passed = इस file के 14 + env के 8; 2 skipped = real-DB file)।
- आज: `api/vitest.config.ts` line 8 **[stage-02]** इसे fast suite से बाहर रखता है; यह
  `npm run test:integration -w api` में चलता है, जिसका global setup test database पर migrations चलाता है
  (`api/tests/global-setup.ts` line 8–30), इसलिए `TEST_DATABASE_URL` और Docker चाहिए।

### साथी file: `api/tests/integration/readiness-real.test.ts`
- line 8–10: `TEST_DATABASE_URL` और `REDIS_URL` दोनों हों तभी चलता है (line 16 `describe.skipIf`)। Foundation commit
  में यह `DATABASE_URL` पढ़ता था (`git show f382ca2:api/tests/integration/readiness-real.test.ts` line 7); stage-02
  में बदलकर `TEST_DATABASE_URL` किया गया, ताकि integration suite सिर्फ़ test DB को छुए **[stage-02]**।
- line 32–36: असली services पर दोनों `up`।
- line 38–48: बंद Sequelize → `postgres: 'down'`, exception नहीं।
- line 27–30: `afterAll` में connections बंद।

---

## 4. `web/src/app/page.test.tsx`

**उद्देश्य:** landing page का server-side render जाँचना। Plan decision 8: `react-dom/server` का
`renderToStaticMarkup`, node environment — jsdom/Testing Library नहीं (कोई नया package नहीं)।

| Line | Code | मतलब |
|---|---|---|
| 1 | `import { renderToStaticMarkup } from 'react-dom/server'` | Component को HTML string में बदलता है |
| 3 | `import Page from './page'` | Landing page component |
| 6 | `const html = renderToStaticMarkup(<Page />)` | एक बार render |
| 8–11 | `<h1` और `LivePulse` मौजूद | Product का नाम दिखता है |
| 13–17 | `/host` और `/join` के असली links; `disabled` शब्द नहीं | **[stage-02]** — यह test stage-02 में बदला गया |

**Foundation वाला दूसरा test** (`git show f382ca2:web/src/app/page.test.tsx`): दोनों buttons ("Create session",
"Join session") `disabled` और `aria-disabled="true"` हों, और "Available in a later release" text हो — यानी
placeholder बिना fake functionality के।

**Verify:** foundation tracking task 9 — 2 tests pass, `next build` (बिना env) exit 0।

`web/vitest.config.ts`: line 4 `esbuild: { jsx: 'automatic' }` (JSX को बिना `import React` compile करना), line 6
`environment: 'node'`, line 7 `include` में `.test.ts` और `.test.tsx` (foundation में सिर्फ़ `.test.tsx` था;
`.test.ts` **[stage-02]**)।

---

## 5. `shared/src/schemas/api.test.ts`

Envelope schemas के 10 tests — पूरा विवरण `01-shared.md` में है। सार: success envelope में `success: true` ज़रूरी;
error envelope में `requestId` ज़रूरी, `details` optional; ready response में कोई dependency `down` नहीं हो सकती;
not-ready details सिर्फ़ `up`/`down` मानते हैं। Foundation: 10 passed।

---

## 6. api Vitest configs

| File | Line | मतलब |
|---|---|---|
| `api/vitest.config.ts` | 6 | `environment: 'node'` |
| | 7 | `tests/**/*.test.ts` और colocated `src/**/*.test.ts` |
| | 8 | **[stage-02]** `tests/integration/**` बाहर — fast suite को DB नहीं चाहिए |
| `api/vitest.integration.config.ts` **[stage-02]** | 7 | सिर्फ़ `tests/integration/**/*.test.ts` |
| | 8 | `globalSetup: ['./tests/global-setup.ts']` — test DB की जाँच और migrations |
| | 10 | `fileParallelism: false` — सारी files एक DB share करती हैं, इसलिए एक-एक करके, ताकि data cleanup आपस में न टकराए |

---

## 7. Root `package.json` scripts

| Line | Script | Command | क्या करता है |
|---|---|---|---|
| 5–9 | `workspaces` | `shared`, `api`, `web` | npm workspaces — एक `npm install` तीनों के लिए, `@livepulse/shared` local link |
| 10–12 | `engines.node` | `>=20` | Node 20 या नया (`process.loadEnvFile`, `import.meta.dirname` के लिए नया Node चाहिए) |
| 14 | `dev:api` | `npm run dev -w api` | API watch mode में |
| 15 | `dev:web` | `npm run dev -w web` | Next.js dev server (port 3000) |
| 16 | `db:migrate` | `npm run db:migrate -w api` | Migrations लागू |
| 17 | `lint` | `eslint .` | पूरे repo पर ESLint |
| 18 | `format` | `prettier --write .` | Files format करके **बदल देता है** |
| 19 | `format:check` | `prettier --check .` | सिर्फ़ जाँच, कुछ नहीं बदलता |
| 20 | `test` | `npm test --workspaces --if-present` | हर workspace का `test` script (api का `test:integration` **नहीं**) |
| 21 | `typecheck` | `npm run typecheck --workspaces --if-present` | हर workspace में `tsc --noEmit` |
| 23–29 | devDependencies | `@eslint/js`, `eslint`, `prettier`, `typescript`, `typescript-eslint` | Root tooling |

Root `dev` script नहीं है: `concurrently` approved नहीं था, इसलिए दो terminals में `dev:api` और `dev:web` (tracking
line 137–138)।

**Verify (foundation):** `npm run lint` exit 0, `npm run typecheck` exit 0, `npm test` — shared 10, api 22 + 2
skipped, web 2 (tracking line 164)। इस doc को लिखते समय दोबारा नहीं चलाया।

---

## 8. `eslint.config.mjs`

ESLint 9 का "flat config" (एक array of config objects)।

| Line | Code | मतलब |
|---|---|---|
| 1–2 | `@eslint/js`, `typescript-eslint` imports | D2 में approved packages |
| 4 | `tseslint.config(...)` | Typed helper जो configs जोड़ता है |
| 5 | `ignores: [node_modules, dist, .next, coverage, next-env.d.ts]` | Generated/बाहरी files lint नहीं। `next-env.d.ts` Next का generated triple-slash reference — web executor ने जोड़ा (tracking line 139–141) |
| 6 | `js.configs.recommended` | JavaScript के recommended नियम |
| 7 | `...tseslint.configs.recommended` | TypeScript के recommended नियम (जैसे unused vars, `any` पर चेतावनी) |
| 8–17 | `**/*.cjs` block | sequelize-cli की CommonJS files (`.sequelizerc` नहीं, पर `sequelize-cli.cjs` और `.cjs` migrations) |
| 12 | `sourceType: 'commonjs'` | `require`/`module.exports` वाली files |
| 13 | `globals: { process, module, require, __dirname }` | Node globals declare, वरना `no-undef` error |
| 16 | `'@typescript-eslint/no-require-imports': 'off'` | sequelize-cli config `require()` से load करता है, इसलिए `.cjs` में `require` allowed |

---

## 9. `.prettierrc` और `.prettierignore`

`.prettierrc`:

| Line | Setting | मतलब |
|---|---|---|
| 2 | `"singleQuote": true` | Strings में `'single'` quotes |
| 3 | `"semi": false` | Statement के अंत में semicolon नहीं |
| 4 | `"trailingComma": "all"` | Multi-line lists/objects में आख़िरी item के बाद भी comma — git diff साफ़ |
| 5 | `"printWidth": 110` | Line 110 characters तक |
| 6 | `"tabWidth": 2` | 2-space indent |

ये CLAUDE.md के code style से मेल खाते हैं (2-space, single quotes, no semicolons)।

`.prettierignore` (line 1–5): `node_modules`, `dist`, `.next`, `coverage`, `package-lock.json` — generated files
format नहीं होतीं।

**Verify:** tracking task 1 — lint और prettier pass; task 9 — web पर भी lint और prettier pass।
