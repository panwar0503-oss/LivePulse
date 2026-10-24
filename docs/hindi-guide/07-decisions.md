# 07 — बड़े निर्णय (Architecture Decision Records)

> हर निर्णय का format: **निर्णय** · **विकल्प** · **क्यों** · **Trade-off** · **स्रोत**।
> मुख्य स्रोत: `CLAUDE.md`, `requirements/foundation/planning-tracking.md` (आगे "F-plan"),
> `requirements/sessions-and-join/planning-tracking.md` (आगे "S-plan"), दोनों `requirement.md`, `api/src/*`।
> जहाँ स्रोत में कारण नहीं लिखा, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

## सारांश तालिका

| # | निर्णय | Phase |
|---|---|---|
| 1 | Express 5 | foundation |
| 2 | Next.js 15 (App Router) | foundation |
| 3 | Tailwind v4 | foundation |
| 4 | Sequelize (Prisma नहीं) | stack |
| 5 | sequelize-cli migrations, `sync` नहीं | foundation |
| 6 | PostgreSQL source of truth | stack |
| 7 | `pgvector/pgvector:pg16` image | foundation |
| 8 | Redis fail-fast (सिर्फ startup पर) | foundation |
| 9 | `/health` बनाम `/ready` | foundation |
| 10 | Error envelope `{success, error}` | foundation |
| 11 | Presenter key: cookie + key एक बार | sessions |
| 12 | Participant HttpOnly cookie | sessions |
| 13 | Room code: 6 अक्षर, 31-अक्षर alphabet | sessions |
| 14 | Join room code से (id से नहीं) | sessions |
| 15 | Session ख़त्म करना final | sessions |
| 16 | SHA-256 hashed tokens | sessions |
| 17 | In-house rate limiter | sessions |
| 18 | Origin check (CSRF बचाव) | sessions |
| 19 | Foundation में zero migrations | foundation |
| 20 | `.env` loading `process.loadEnvFile` से | foundation |
| 21 | `createApp(deps)` factory | foundation |

---

## ADR-1: Express 5
- **निर्णय:** API के लिए Express 5।
- **विकल्प:** Express 4, Fastify, NestJS।
- **क्यों:** Stack `CLAUDE.md` में तय है (Express)। Version 5 developer ने D3 में चुना। Express 5 rejected promises
  (async errors) को खुद error middleware तक भेजता है, इसलिए हर controller में `try/catch` या wrapper नहीं चाहिए
  (`.claude/rules/backend-api.md`)।
- **Trade-off:** कुछ पुराने Express 4 middleware/examples सीधे फिट नहीं होते; ecosystem docs ज़्यादातर v4 के हैं।
- **स्रोत:** F-plan Decisions D3।

## ADR-2: Next.js 15 (App Router)
- **निर्णय:** Web के लिए Next 15, App Router (`web/src/app/`)।
- **विकल्प:** Pages Router, Vite + React SPA।
- **क्यों:** Stack `CLAUDE.md` में तय; version D3 में चुना। Server Components default, `'use client'` सिर्फ state/effects के लिए।
- **Trade-off:** App Router के नियम (server vs client component) सीखने पड़ते हैं। Build में
  "Next.js plugin was not detected in your ESLint configuration" warning अभी है।
- **स्रोत:** F-plan D3; `.claude/rules/frontend-react.md`; S-plan Issues।

## ADR-3: Tailwind v4
- **निर्णय:** Tailwind v4, `@tailwindcss/postcss` के साथ।
- **विकल्प:** Tailwind v3, CSS modules।
- **क्यों:** D3 में चुना; `@tailwindcss/postcss` D2 में approve हुआ। गहरा कारण दर्ज नहीं (पुष्टि नहीं हुई)।
- **Trade-off:** v4 config v3 से अलग है; पुराने tutorials सीधे काम नहीं करते।
- **स्रोत:** F-plan D2, D3।

## ADR-4: Sequelize (Prisma नहीं)
- **निर्णय:** ORM सिर्फ Sequelize।
- **विकल्प:** Prisma, TypeORM, Drizzle, raw `pg`।
- **क्यों:** `CLAUDE.md` में non-negotiable: "**Sequelize** (no other ORM)"। लिखित कारण वहाँ नहीं है (पुष्टि नहीं हुई)।
  Developer का Node/Express अनुभव और explicit transactions/locks (`FOR SHARE`, `FOR UPDATE`) पर सीधा नियंत्रण इसके अनुकूल हैं।
- **Trade-off:** Prisma जैसी auto-generated types नहीं; models हाथ से typed करने पड़ते हैं, और migration को model से मिलाना हमारी ज़िम्मेदारी है।
  हर query में `{ transaction }` भूलने पर query चुपचाप transaction से बाहर चली जाती है।
- **स्रोत:** `CLAUDE.md`; `.claude/rules/database-sequelize.md`।

## ADR-5: sequelize-cli migrations, `sync` नहीं
- **निर्णय:** Schema बदलाव सिर्फ generated migrations (`up` + `down`) से। `sync({ force | alter })` tests के बाहर मना।
- **विकल्प:** `sequelize.sync()`, Umzug, हाथ से SQL।
- **क्यों:** Database को शून्य से दोबारा बनाया और वापस लिया जा सके; बदलाव versioned और review-able हों।
  Migrations `.cjs` हैं ताकि sequelize-cli को ts-node न चाहिए।
- **Trade-off:** Model और migration दो जगह — मेल रखना पड़ता है। `down` destructive है (सारा data मिटाता है), इसलिए असली data पर मंज़ूरी चाहिए।
- **स्रोत:** `CLAUDE.md`; foundation requirement Assumption 1; F-plan decision 4; S-plan A3।

## ADR-6: PostgreSQL source of truth
- **निर्णय:** सच्चाई सिर्फ PostgreSQL में। Redis Pub/Sub durable नहीं है।
- **विकल्प:** Redis में state रखना, in-memory state।
- **क्यों:** Persist → commit → फिर emit। Event छूट जाए तो client reconnect पर HTTP से दोबारा मँगाता है — data नहीं खोता।
  Invariants DB constraints से लागू (जैसे `room_code` UNIQUE, status/ended_at CHECK)।
- **Trade-off:** हर live action पर DB write; Redis से थोड़ा धीमा। Reconnect logic client में लिखना पड़ेगा।
- **स्रोत:** `CLAUDE.md`।

## ADR-7: `pgvector/pgvector:pg16` image
- **निर्णय:** Docker में शुरू से pgvector वाली PostgreSQL image।
- **विकल्प:** Plain `postgres:16`, अलग vector DB (Pinecone/Qdrant)।
- **क्यों:** AI phases (9+) में embeddings PostgreSQL में ही रहेंगे — अलग vector DB नहीं (`CLAUDE.md`, `docs/08` non-goals)।
  Image अभी से ताकि बाद में image बदलनी न पड़े। Extension खुद Phase 9 में बनेगा।
- **Trade-off:** Image थोड़ी बड़ी; platform के हिसाब से फ़र्क का जोखिम (foundation requirement Risks: MEDIUM)।
- **स्रोत:** F-plan decision 4; `docker-compose.yml`।

## ADR-8: Redis fail-fast (सिर्फ startup पर)
- **निर्णय:** Startup पर Redis न मिले → process exit(1) साफ़ message के साथ। चालू होने के बाद Redis गिरे → हमेशा retry, `/ready` 503 देता है और अपने-आप ठीक होता है।
- **विकल्प:** Redis optional (`REDIS_REQUIRED` flag), Redis के बिना चलते रहना।
- **क्यों:** बाद में multi-instance broadcast Redis पर निर्भर है; बिना Redis चलना updates को चुपचाप खो देगा।
  PostgreSQL startup पर fatal नहीं — उसकी स्थिति `/ready` में दिखती है।
- **Trade-off:** Redis गलत configure हो तो पहली local start कठिन। Initial connect पर 10 s cap जोड़ा गया (Windows dual-stack hang के बाद)।
- **स्रोत:** foundation requirement Assumption 2; F-plan decisions 2, 3; `api/src/db/redis.ts`।

## ADR-9: `/health` बनाम `/ready`
- **निर्णय:** `/health` = process ज़िंदा है (हमेशा 200)। `/ready` = PostgreSQL और Redis पहुँच में हैं (200), वरना 503 `NOT_READY`।
- **विकल्प:** एक ही endpoint।
- **क्यों:** Liveness (restart करना है?) और readiness (traffic भेजना है?) अलग सवाल हैं। हर check पर 1 s timeout। दोनों root पर, `/api` के नीचे नहीं; कोई version/host/secret नहीं।
- **Trade-off:** दो endpoints maintain करने पड़ते हैं। 1 s timeout का hanging dependency पर व्यवहार (पुष्टि नहीं हुई)।
- **स्रोत:** F-plan Architecture, decision 3; `api/src/app.ts`।

## ADR-10: Error envelope `{ success, error }`
- **निर्णय:** सफलता: `{ success: true, data }`। Error: `{ success: false, error: { code, message, details?, requestId } }`।
- **विकल्प:** Plain `{ message }`, RFC 7807 problem+json।
- **क्यों:** Web client एक ही तरीके से parse करे (`shared` के `successEnvelope`/`errorEnvelope`); हर error में request ID ताकि log में ढूँढ सकें; stack trace कभी client को नहीं।
- **Trade-off:** हर response थोड़ा भारी; envelope `shared` में बदलना पड़े तो दोनों तरफ़ बदलाव।
- **स्रोत:** F-plan Decisions D1; `api/src/middleware/error-handler.ts`।

## ADR-11: Presenter key — cookie + key सिर्फ एक बार
- **निर्णय:** Create पर presenter key response में **एक बार** मिलती है और साथ में `lp_presenter_<sessionId>` HttpOnly cookie set होती है। दूसरे device पर key एक बार डालें (`POST /api/sessions/:id/presenter-access`) → cookie मिलती है।
- **विकल्प:** `Authorization: Bearer` header (docs/04 का पुराना design), key URL में, localStorage।
- **क्यों:** Key कभी URL या page-readable storage में नहीं रहती; बनाने वाले browser को दोबारा key नहीं चाहिए।
- **Trade-off:** Key खो जाए और cookie भी न हो → session में वापसी का कोई रास्ता नहीं (requirement Risk MEDIUM)। Cookie में असली key है (hash नहीं), इसलिए cookie चोरी = presenter access।
- **स्रोत:** sessions requirement Assumption 1; S-plan decisions 3, 4।

## ADR-12: Participant HttpOnly cookie
- **निर्णय:** Participant की पहचान `lp_participant_<sessionId>` cookie में; `HttpOnly; SameSite=Lax; Path=/api; Max-Age=7d`; `Secure` सिर्फ production में।
- **विकल्प:** `X-Participant-Token` header + localStorage (docs/04 का पुराना design)।
- **क्यों:** Page scripts cookie नहीं पढ़ सकते (XSS से token चोरी कठिन)। Per-session नाम, इसलिए session A की cookie session B में काम नहीं करती (401)।
- **Trade-off:** Web (3000) और API (4000) अलग ports पर — कुछ browsers में cookie न चलने का जोखिम; असली browser में (पुष्टि नहीं हुई)। एक ही browser के दो tabs एक साथ join करें तो दो participants बन सकते हैं (स्वीकार किया)।
- **स्रोत:** sessions requirement Assumption 2, Risks; S-plan decision 3, Concurrency।

## ADR-13: Room code — 6 अक्षर, 31-अक्षर alphabet
- **निर्णय:** `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (0, O, 1, I, L हटाए) से 6 अक्षर, `crypto.randomInt` से।
- **विकल्प:** सिर्फ अंक, लंबे codes, शब्द-आधारित codes।
- **क्यों:** मिलते-जुलते अक्षर नहीं, तो बोलना/टाइप करना आसान। 31⁶ ≈ 10⁹ combinations + rate limit = अंदाज़ा लगाना कठिन।
  टकराव पर 5 बार तक retry (हर बार अलग INSERT, transaction के बाहर), फिर 500 `ROOM_CODE_UNAVAILABLE`।
- **Trade-off:** Code discovery है, authorization नहीं — code जानने वाला join कर सकता है। Plan में पहले 32 लिखा था, सही गिनती 31 है (ठीक किया गया)।
- **स्रोत:** sessions requirement behaviour 5, Assumption 3; S-plan decision 6, Issues; `shared/src/schemas/sessions.ts`।

## ADR-14: Join room code से (id से नहीं)
- **निर्णय:** `POST /api/sessions/by-code/:code/join`, `GET /api/sessions/by-code/:code/participant-me`।
- **विकल्प:** `/api/sessions/:id/join` (docs/04 का पुराना design)।
- **क्यों:** Public lookup को कभी internal ID नहीं दिखानी (requirement behaviour 10)। Participant के पास सिर्फ code होता है।
  Lookup और join एक ही rate-limit bucket (20/IP/मिनट) साझा करते हैं।
- **Trade-off:** Controller को cookie का नाम जानने के लिए पहले code से session id ढूँढनी पड़ती है (एक अतिरिक्त query)। docs/04 बदलनी पड़ी।
- **स्रोत:** S-plan decision 2, Decisions 1–2; `sessions.controller.ts`।

## ADR-15: Session ख़त्म करना final है
- **निर्णय:** Ended session दोबारा नहीं खुलता। दोबारा end करना harmless (200, `ended_at` नहीं बदलता)।
- **विकल्प:** Pause/reopen।
- **क्यों:** MVP सरल रहे; developer ने चुना। End `FOR UPDATE` lock में चलता है ताकि चल रहे join (जो `FOR SHARE` लेते हैं) पहले पूरे हों।
- **Trade-off:** गलती से end किया तो नया session बनाना पड़ेगा। Race test ने `ended_at` ordering bug पकड़ा था — ठीक हुआ।
- **स्रोत:** sessions requirement Assumption 4, behaviour 12; S-plan Concurrency, Issues; `sessions.service.ts` `endSession`।

## ADR-16: SHA-256 hashed tokens (यह सुरक्षित क्यों है)
- **निर्णय:** Token = `randomBytes(32)` (256 bit), base64url। DB में सिर्फ `sha256(token)` (hex, 64 chars)। मिलान `crypto.timingSafeEqual` से।
- **विकल्प:** bcrypt / argon2, plain token DB में।
- **क्यों सुरक्षित:** bcrypt/argon2 *कमज़ोर, इंसानी passwords* के लिए हैं — वे जानबूझकर धीमे होते हैं ताकि guessing महँगी हो। यहाँ token मशीन-generated और 2²⁵⁶ संभावनाओं वाला है; उसे brute force करना असंभव है, चाहे hash तेज़ हो। DB leak होने पर भी hash से असली token नहीं मिलता। bcrypt एक नया package जोड़ता पर सुरक्षा नहीं बढ़ाता।
- **Trade-off:** यह तर्क तभी तक सही है जब तक token random और लंबे हैं — इंसान के चुने passwords पर यह तरीका नहीं चलेगा।
- **स्रोत:** S-plan decisions 4, 5; `api/src/lib/tokens.ts`।

## ADR-17: In-house rate limiter (package नहीं)
- **निर्णय:** छोटा in-memory fixed-window limiter, injectable clock, `req.ip` से key (presenter-key के लिए session id से)।
- **विकल्प:** `express-rate-limit`, Redis store।
- **क्यों:** `CLAUDE.md` के अनुसार नया package पूछकर ही; plan ने कोई package propose नहीं किया (A1)। ज़रूरत छोटी है और injectable clock से test आसान।
- **Trade-off:** सिर्फ एक process के लिए। कई API instances पर हर instance की अलग गिनती होगी — तब Redis store चाहिए। Process restart पर गिनती reset।
  Proxy के पीछे सही IP के लिए `TRUST_PROXY` चाहिए (असली proxy पर पुष्टि नहीं हुई)।
- **स्रोत:** S-plan decision 7, A1, Decisions 4; `api/src/middleware/rate-limit.ts`।

## ADR-18: Origin check (CSRF बचाव)
- **निर्णय:** Unsafe methods (POST/PUT/PATCH/DELETE) पर अगर `Origin` header allowlist (`WEB_ORIGIN`) में नहीं → 403 `FORBIDDEN_ORIGIN`। साथ में `SameSite=Lax` और सिर्फ JSON bodies।
- **विकल्प:** CSRF token (double-submit), `SameSite=Strict`।
- **क्यों:** Browsers cross-site unsafe requests पर हमेशा `Origin` भेजते हैं, इसलिए यह check CSRF रोकता है, बिना token प्रबंधन के।
- **Trade-off:** `Origin` header न हो तो अनुमति (curl, server-to-server चलें) — यह जानबूझकर है।
- **स्रोत:** S-plan decision 9; `api/src/middleware/origin-check.ts`।

## ADR-19: Foundation में zero migrations
- **निर्णय:** Phase 2 में कोई migration नहीं; पहला `db:migrate` सिर्फ `SequelizeMeta` बनाता है। पहली असली migration Phase 3 में।
- **विकल्प:** Placeholder/dummy migration।
- **क्यों:** उस phase में कोई data model scope में नहीं था; बेकार code नहीं ("code is liability")।
- **Trade-off:** Foundation का success criterion 7 (migration revert) सिर्फ no-op के रूप में दिखा — partial। असली up/down Phase 3 में test DB पर verify हुआ।
- **स्रोत:** F-plan decision 4, D4; foundation requirement change log।

## ADR-20: `.env` loading `process.loadEnvFile` से
- **निर्णय:** `api/src/server.ts` और `api/src/config/sequelize-cli.cjs` repo-root `.env` को Node के built-in `process.loadEnvFile` से पढ़ते हैं — सिर्फ जब फ़ाइल मौजूद हो। पहले से set env variables जीतते हैं।
- **विकल्प:** `dotenv` package।
- **क्यों:** README `.env` बनाने को कहता था पर कोई उसे पढ़ता नहीं था (Issue MEDIUM)। Node 24 में यह built-in है, नया package नहीं चाहिए।
- **Trade-off:** Node के नए version पर निर्भरता (पुराने Node में यह API नहीं) (पुष्टि नहीं हुई कि minimum Node version कहीं pin है)।
- **स्रोत:** F-plan Issues 2026-10-24; `api/src/server.ts`।

## ADR-21: `createApp(deps)` factory
- **निर्णय:** `createApp({ env, logger, readiness, sequelize, models })` — dependencies बाहर से inject।
- **क्यों:** Supertest बिना Docker के चल सके (stub readiness), और हर test का अपना app व अपने rate-limit counters।
- **Trade-off:** नई dependency जुड़ने पर सारे tests में पास करनी पड़ती है (जैसे Phase 3 में `sequelize`)।
- **स्रोत:** F-plan decision 1; S-plan Impact analysis; `api/src/app.ts`।
