# 10 — शब्दावली (Glossary)

> हर शब्द: **हिंदी अर्थ** + **LivePulse में आसान उदाहरण**। Technical शब्द English में ही रखे गए हैं,
> क्योंकि developers इन्हें ऐसे ही बोलते हैं।

## A. Backend और HTTP

| शब्द | हिंदी अर्थ | LivePulse में उदाहरण |
|---|---|---|
| **API** | दो programs के बीच बात करने का तय तरीका (अनुबंध) | Web, `api/` से HTTP पर बात करता है |
| **Endpoint** | API का एक खास पता + method | `POST /api/sessions` — नया session बनाता है |
| **Middleware** | Request और handler के बीच चलने वाला function — जाँच या तैयारी करता है | `requestId`, `origin-check`, `rate-limit`, `validate` (`api/src/middleware/`) |
| **Route** | URL को सही middleware और controller से जोड़ना | `api/src/routes/sessions.routes.ts` |
| **Controller** | HTTP की परत — `req` पढ़ता है, `res` भेजता है | `controller.create` cookie set करके `201` भेजता है |
| **Service** | Business rules की परत — `req`/`res` नहीं जानती | `createSession()` key बनाता है, room code retry करता है |
| **Model** | Database table का typed रूप (Sequelize में) | `Session`, `Participant` (`api/src/models/`) |
| **Migration** | Database schema बदलने वाली versioned फ़ाइल, `up` (लागू) और `down` (वापस) के साथ | `api/migrations/20261024034903-create-sessions-and-participants.cjs` |
| **Transaction** | कई DB कामों का समूह — या तो सब होंगे या कोई नहीं | Join: session पढ़ो, ACTIVE जाँचो, participant insert — एक transaction में |
| **FOR SHARE lock** | Row पर "पढ़ने वाला" lock — दूसरे भी पढ़ सकते हैं, पर कोई उसे बदल नहीं सकता जब तक lock है | Join session row को `FOR SHARE` से पढ़ता है, तो उसी समय end उसे ENDED नहीं कर सकता |
| **FOR UPDATE lock** | "लिखने वाला" lock — दूसरे lock वालों को इंतज़ार करवाता है | `endSession` पहले चल रहे joins के ख़त्म होने का इंतज़ार करता है |
| **Unique constraint** | DB का नियम कि कोई value दोहराई न जाए | `room_code` UNIQUE — टकराव पर service retry करती है |
| **Envelope** | हर response का एक जैसा लिफ़ाफ़ा (shape) | `{ success: true, data }` या `{ success: false, error: { code, message, requestId } }` |
| **DTO** (Data Transfer Object) | बाहर भेजने के लिए चुना हुआ data — पूरा DB record नहीं | `toPublicSession` सिर्फ `title, status, roomCode` देता है; hash कभी नहीं |
| **Request ID** | हर request की पहचान संख्या, logs में ढूँढने के लिए | Error body में `requestId` |
| **Liveness / Readiness** | ज़िंदा है? / काम के लिए तैयार है? | `/health` बनाम `/ready` |

## B. Security

| शब्द | हिंदी अर्थ | उदाहरण |
|---|---|---|
| **Cookie** | Browser में रखा छोटा data, जो हर मिलते request के साथ अपने-आप server को जाता है | `lp_presenter_<sessionId>` |
| **HttpOnly** | Cookie flag — page का JavaScript इसे पढ़ नहीं सकता | Participant token XSS से चुराना कठिन |
| **SameSite** | Cookie flag — दूसरी site से आए requests पर cookie भेजी जाए या नहीं | `SameSite=Lax` |
| **Secure** | Cookie सिर्फ HTTPS पर जाए | सिर्फ `NODE_ENV=production` में |
| **CORS** (Cross-Origin Resource Sharing) | Browser का नियम: किस दूसरे origin का page हमारी API पढ़ सकता है | सिर्फ `WEB_ORIGIN` list, `credentials: true`, कभी `*` नहीं |
| **Origin** | Scheme + host + port | `http://localhost:3000` |
| **CSRF** (Cross-Site Request Forgery) | कोई बुरी site आपके browser से, आपकी cookie के साथ, request भिजवा दे | Origin check 403 `FORBIDDEN_ORIGIN` देता है |
| **Rate limit** | तय समय में requests की सीमा | Join + lookup: 20 प्रति IP प्रति मिनट → फिर 429 `RATE_LIMITED` |
| **Hash** | एक-तरफ़ा fingerprint — hash से असली value वापस नहीं मिलती | DB में `presenter_key_hash` (SHA-256), असली key नहीं |
| **Timing-safe compare** | ऐसी तुलना जिसमें समय इस पर निर्भर न करे कि कितने अक्षर मिले — ताकि समय नापकर अंदाज़ा न लगे | `crypto.timingSafeEqual` (`api/src/lib/tokens.ts`) |
| **Token** | Random गुप्त string जो पहचान साबित करती है | 32 random bytes, base64url |
| **Helmet** | Security headers लगाने वाला Express middleware | `app.use(helmet())` |
| **Redaction** | Logs से गुप्त चीज़ें छिपाना | `cookie`, `authorization` headers log में redact |

## C. Tools और Libraries

| शब्द | हिंदी अर्थ | उदाहरण |
|---|---|---|
| **Zod** | TypeScript schema library — runtime पर data जाँचती है | `createSessionBodySchema` (title 1–80) |
| **Sequelize** | Node.js का ORM — JS objects से SQL | `Session.create({...})` → `INSERT` |
| **ORM** | Object-Relational Mapper — tables को classes की तरह इस्तेमाल करना | Sequelize |
| **PostgreSQL** | Relational database — यहाँ सच का स्रोत | `sessions`, `participants` tables |
| **pgvector** | PostgreSQL extension जो embeddings (vectors) रखता और खोजता है | Phase 9 से; image अभी `pgvector/pgvector:pg16` |
| **Redis** | तेज़ in-memory data store + Pub/Sub | अभी startup check और `/ready`; Phase 4 में Socket.IO adapter |
| **Pub/Sub** | Publish/Subscribe — एक भेजे, कई सुनें; durable नहीं | Multi-instance broadcast (Phase 4) |
| **Socket.IO** | Browser और server के बीच दो-तरफ़ा live connection | Phase 4 में live updates |
| **Redis adapter** | Socket.IO events को कई server instances तक पहुँचाना | `@socket.io/redis-adapter` (Phase 4) |
| **Docker Compose** | एक command से कई containers चलाना | `docker compose up -d` → postgres + redis |
| **Vitest** | Test runner | `npm test -w api` |
| **Supertest** | Express app पर बिना port खोले HTTP tests | `api/tests/integration/*.test.ts` |
| **pino** | Structured (JSON) logger | `api/src/config/logger.ts` |

## D. Project संरचना और Config

| शब्द | हिंदी अर्थ | उदाहरण |
|---|---|---|
| **Monorepo** | एक repository में कई packages | `web/`, `api/`, `shared/` |
| **Workspace** (npm) | Monorepo का एक package, root से चलाया जा सके | `npm run dev -w api` |
| **env** (environment variables) | Code के बाहर से आने वाली settings | `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN` |
| **`.env` / `.env.example`** | Local settings फ़ाइल / सिर्फ placeholders वाला नमूना | `.env` कभी commit या print नहीं |
| **Fail-fast** | गड़बड़ी हो तो तुरंत, साफ़ message के साथ रुक जाना | Redis न मिले तो API start ही नहीं होता |
| **Graceful shutdown** | बंद होने से पहले चल रहे काम और connections ठीक से बंद करना | SIGINT/SIGTERM handler (पुष्टि नहीं हुई) |
| **Factory** | Object बनाने वाला function, dependencies बाहर से | `createApp(deps)` |

## E. Frontend

| शब्द | हिंदी अर्थ | उदाहरण |
|---|---|---|
| **SSR** (Server-Side Rendering) | HTML server पर बनकर browser को आता है | Next.js का default |
| **Server Component** | सिर्फ server पर चलने वाला React component (state/effects नहीं) | Next.js App Router में default |
| **Client Component** | Browser में चलने वाला component; फ़ाइल के ऊपर `'use client'` | `web/src/app/host/page.tsx` (form state) |
| **App Router** | Next.js का folder-आधारित routing (`src/app/`) | `web/src/app/join/page.tsx` → `/join` |
| **`NEXT_PUBLIC_*`** | वे env variables जो browser तक पहुँचते हैं — public मानें | `NEXT_PUBLIC_API_URL` |
| **Tailwind** | Utility CSS classes | `className="mx-auto max-w-xl"` |

## F. Testing

| शब्द | हिंदी अर्थ | उदाहरण |
|---|---|---|
| **Unit test** | एक छोटे हिस्से का अलग test | `api/src/lib/tokens.test.ts` |
| **Integration test** | कई हिस्से साथ, असली DB के साथ | `api/tests/integration/join.test.ts` (`livepulse_test` DB) |
| **E2E** (End-to-End) | असली browser में पूरा user flow | अभी नहीं — 12-step flow सिर्फ HTTP पर चला |
| **TDD** (Test-Driven Development) | पहले failing test, फिर code, फिर refactor | `/bug-fix` command यही तरीका अपनाता है |
| **Race test** | दो काम एक साथ चलाकर टकराव जाँचना | Join बनाम end race test ने `ended_at` bug पकड़ा |

## G. Claude Code workflow

| शब्द | हिंदी अर्थ | उदाहरण |
|---|---|---|
| **`CLAUDE.md`** | Project के स्थायी निर्देश जो Claude हर बार पढ़ता है | Stack, non-negotiable नियम, commands |
| **Agent** (subagent) | किसी खास काम के लिए अलग Claude instance | `executor-low/medium/high` — plan के tasks बनाते हैं |
| **Command** (slash command) | `.claude/commands/` में तैयार workflow | `/requirement <name>`, `/execute <name>`, `/bug-fix` |
| **Skill** | Patterns और उदाहरणों का संग्रह जो ज़रूरत पर लोड होता है | `backend-patterns`, `testing-patterns` |
| **Rule** | `.claude/rules/` की convention फ़ाइल, matching फ़ाइल पढ़ने पर अपने-आप लागू | `.claude/rules/security.md` |
| **Hook** | किसी event (जैसे tool चलने) पर अपने-आप चलने वाली script | (इस repo में configuration की पुष्टि नहीं हुई) |
| **Memory** | Conversations के पार याद रखी जाने वाली जानकारी | User profile, LivePulse phases |
| **Requirement / planning-tracking** | Business भाषा में व्यवहार / technical plan + task status | `requirements/sessions-and-join/*.md` |
