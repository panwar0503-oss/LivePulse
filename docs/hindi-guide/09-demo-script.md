# 09 — CTO Demo Script (20–25 मिनट)

> यह फ़ाइल LivePulse का **असली, अभी बना हुआ** हिस्सा दिखाने के लिए है: Phase 2 (foundation) और Phase 3
> (sessions-and-join)। Polls, realtime और AI अभी **नहीं बने** हैं। इन्हें "आगे क्या" वाले हिस्से में ही बताएँ।
> Source: `docs/12-demo-and-interview.md`, `requirements/foundation/*`, `requirements/sessions-and-join/*`.

## समय-सारणी (Time plan)

| # | Section | समय |
|---|---|---|
| 1 | मंच सेटअप (stage setup) और health check | 2 मिनट |
| 2 | Product demo | 6 मिनट |
| 3 | Code walkthrough (5 फ़ाइलें) | 5 मिनट |
| 4 | Claude workflow demo | 4 मिनट |
| 5 | Tests | 2 मिनट |
| 6 | Architecture | 2 मिनट |
| 7 | आगे क्या (roadmap) | 2 मिनट |
| — | सवाल-जवाब के लिए बचा समय | 2–5 मिनट |

---

## 1. मंच सेटअप (Stage setup) — demo से 15 मिनट पहले

### विंडो (windows) का क्रम
| विंडो | किस लिए |
|---|---|
| Terminal 1 | `docker compose up -d`, फिर migration |
| Terminal 2 | `npm run dev:api` (API, port 4000) |
| Terminal 3 | `npm run dev:web` (web, port 3000) |
| Terminal 4 | tests और `curl` के लिए खाली रखें |
| Browser A (Chrome, normal window) | Presenter |
| Browser B (Chrome, Incognito) | Participant 1 |
| Browser C (Edge या Firefox) | Participant 2 |
| Editor (VS Code) | Code walkthrough के लिए 5 फ़ाइलें पहले से tab में खुली रखें |

Incognito और दूसरा browser इसलिए, क्योंकि हर browser का अपना **cookie jar** (cookies का अलग डिब्बा) होता है।
इससे तीन अलग लोग असली जैसे दिखते हैं।

### Commands (repo root `C:\Users\dell\LivePulse` से)
1. `docker compose up -d` — PostgreSQL (pgvector image) और Redis चालू।
2. `docker compose ps` — दोनों `healthy` दिखने चाहिए।
3. `npm run db:migrate` — sessions और participants tables बनाता है। हर नए database पर **एक बार** ज़रूरी है।
   (tracking में दर्ज issue: dev database migrate नहीं था तो API ने 500 दिया था।)
4. Terminal 2: `npm run dev:api`
5. Terminal 3: `npm run dev:web`
6. Health check (Terminal 4):
   - `curl http://localhost:4000/health` → `{"success":true,"data":{"status":"ok"}}`
   - `curl http://localhost:4000/ready` → `status: "ready"`, `checks: { postgres: "up", redis: "up" }`
7. Browser A में `http://localhost:3000` खोलें।

> नोट: `docs/09-local-development.md` में `npm run dev` लिखा है, पर root `package.json` में scripts
> `dev:api` और `dev:web` हैं। Demo में यही दो चलाएँ।

### CTO को क्या बोलें
"यह local setup है: Docker Compose में PostgreSQL और Redis। `/health` बताता है process ज़िंदा है (liveness),
`/ready` बताता है कि database और Redis दोनों जवाब दे रहे हैं (readiness)। अगर कोई down हो तो `/ready` 503
देता है, बिना कोई secret बताए।"

### अगर fail हो तो fallback
- `/ready` 503 दे → `docker compose ps` देखें; container restart करें: `docker compose up -d`।
- Port 5432 पहले से busy (Windows पर local Postgres) → `docs/09` का port-clash नोट देखें।
- API 500 दे sessions पर → `npm run db:migrate` दोबारा चलाएँ।
- कुछ भी न चले → section 5 (tests) और section 3 (code) पहले दिखाएँ; tests बिना browser के भी व्यवहार साबित करते हैं।

---

## 2. Product demo (6 मिनट)

### Step 2.1 — Session बनाना (Browser A)
1. Landing page → **Create session**।
2. Title: `AI in Product Teams`, description खाली छोड़ें (optional है)।
3. Submit → screen पर दिखेगा: **room code** (6 अक्षर), **join link**, और **presenter key**।

**CTO को क्या बोलें:**
"Room code खोजने के लिए है (discovery), अधिकार के लिए नहीं (authorization)। Code 31 अक्षरों के set से बनता है
जिसमें 0, O, 1, I, L नहीं हैं, ताकि पढ़ने में गलती न हो। Presenter key सिर्फ़ **एक बार** दिखती है — database में
उसका केवल SHA-256 hash रखा है, इसलिए हम खुद भी इसे दोबारा नहीं दिखा सकते।"

### Step 2.2 — Presenter key का महत्व
1. Dashboard खोलें (`/host/<sessionId>`): title, status, code, join link, joined count = 0।
2. यही URL Browser C (दूसरा browser) में खोलें → presenter key माँगेगा।
3. गलत key डालें → साफ़ error, और कुछ नहीं बताता।
4. सही key डालें → dashboard खुल जाता है।

**CTO को क्या बोलें:**
"बनाने वाले browser में presenter एक `HttpOnly` cookie से पहचाना जाता है — page का JavaScript इसे पढ़ नहीं सकता।
दूसरे device पर key एक बार डालनी पड़ती है। Key कभी URL में नहीं जाती, log में नहीं जाती। Key guessing पर
rate limit है: हर session पर 15 मिनट में 10 प्रयास।"

### Step 2.3 — दो browsers में participant join
1. Browser B: `http://localhost:3000/join` → code और नाम `Asha` → join।
2. Browser C (या दूसरा incognito): वही code, नाम `Ravi` → join।
3. Browser A का dashboard refresh करें → **joined count = 2**।

**CTO को क्या बोलें:**
"कोई account नहीं। हर participant को उस **एक session** के लिए अलग cookie मिलती है। Count अभी 'जो join हुए' उनकी
गिनती है, 'अभी online' की नहीं — live presence realtime phase में आएगा। इसलिए अभी refresh करना पड़ता है।"

### Step 2.4 — Refresh करके identity बचना
1. Browser B में page refresh करें → `Asha` वही रहती है, दोबारा join नहीं माँगता।
2. Dashboard refresh → count अब भी 2 (कोई नया participant नहीं बना)।

**CTO को क्या बोलें:**
"Refresh पर page `participant-me` endpoint से पूछता है। Cookie का hash database से मिलाया जाता है, और यह भी check
होता है कि participant **इसी** session का है। Session A की cookie session B में 401 देती है।"

### Step 2.5 — End session के बाद join block
1. Browser A → **End session** → confirm → status `ENDED`।
2. नया incognito window → उसी code से join → generic message: "not found or not open"।
3. End दोबारा दबाएँ (अगर UI दिखाए) → कुछ नहीं बदलता (idempotent)।

**CTO को क्या बोलें:**
"Unknown code और ended code का जवाब एक जैसा है, ताकि guess करने वाले को पता न चले कि कौन-सा code असली है। End final
है। और join व end एक साथ हों तो भी कोई join, end के commit होने के बाद commit नहीं हो सकता — यह database lock से
तय है, code में आगे दिखाऊँगा।"

### अगर fail हो तो fallback
- Refresh पर identity खो जाए → यह **ज्ञात जोखिम** है: real browser में ports 3000 और 4000 के बीच cookie व्यवहार
  अभी verify नहीं हुआ (tracking में "NOT VERIFIED")। सच बोलें, और `api/tests/integration/join.test.ts` का test
  दिखाएँ जो cookie jar के साथ यही flow साबित करता है।
- UI अटक जाए → Terminal 4 से API सीधे दिखाएँ (cookie jar फ़ाइल scratch में रखें), उदाहरण:
  `curl -i -X POST http://localhost:4000/api/sessions -H "Content-Type: application/json" -H "Origin: http://localhost:3000" -d "{\"title\":\"Demo\"}"`
  (`api/src/middleware/origin-check.ts` lines 11–13: अगर `Origin` header है और `WEB_ORIGIN` allowlist में नहीं,
  तो POST को 403 `FORBIDDEN_ORIGIN`। Origin न हो तो request जाने दी जाती है, ताकि `curl` चले — line 7 का comment।)

---

## 3. Code walkthrough (5 फ़ाइलें, 5 मिनट)

| # | फ़ाइल | क्या दिखाएँ (line numbers) | क्यों |
|---|---|---|---|
| 1 | `api/src/routes/sessions.routes.ts` | Lines 26–35: तीन rate limiters (create 10/घंटा, join 20/मिनट, presenter-key 10 / session / 15 मिनट)। Line 38: origin check हर POST पर। Lines 43–50: limiter validation से **पहले** चलता है। | Route सिर्फ़ wiring है: limiter → Zod validation → controller। Security नियम एक नज़र में दिखते हैं। |
| 2 | `api/src/services/participants.service.ts` | Lines 16–22: transaction और `lock: transaction.LOCK.SHARE` (SQL `FOR SHARE`)। Lines 24–26: unknown और ended का एक ही 404। Lines 28–35: same browser दोबारा join करे तो पुराना participant लौटता है। | Join vs end race (दौड़) का हल। |
| 2b | `api/src/services/sessions.service.ts` (साथ में) | Lines 94–106: `endSession` `LOCK.UPDATE` के साथ; `endedAt` lock मिलने के **बाद** सेट होता है। | यह bug race test ने पकड़ा था — असली कहानी। |
| 3 | `api/src/lib/tokens.ts` | Line 5: 32 random bytes (256 bit)। Lines 8–11: SHA-256, बिना salt — comment में कारण। Lines 14–19: `timingSafeEqual`। | Token कभी plain database में नहीं। |
| 4 | `api/src/lib/cookies.ts` | Lines 29–34: हमेशा `HttpOnly; SameSite=Lax`, `Secure` सिर्फ़ production में। Line 30: cookie name validation। | बिना नया package जोड़े सुरक्षित cookies। |
| 5 | `api/migrations/20261024034903-create-sessions-and-participants.cjs` | Line 6: पूरी migration एक transaction में। Lines 33–39: CHECK constraint `(status='ENDED') = (ended_at IS NOT NULL)`। Lines 41–47: room code format का CHECK। Lines 23, 66: hash columns `UNIQUE`। Lines 81–91: `down` पर चेतावनी। | Invariants (हमेशा सच रहने वाले नियम) database में, सिर्फ़ code में नहीं। |

### CTO को क्या बोलें
"Join एक transaction में session row को `FOR SHARE` lock करता है। End उसी row पर `FOR UPDATE` लेता है, इसलिए वह
चल रहे joins के ख़त्म होने का इंतज़ार करता है। पहली version में `ended_at` lock से पहले तय हो जाता था, तो ended
time participant के created time से पहले आ सकता था — race test ने यह पकड़ा, और हमने `endSession` को locking
transaction में डाला। Tokens 256-bit random हैं, इसलिए plain SHA-256 काफ़ी है; bcrypt एक package बढ़ाता पर सुरक्षा नहीं।"

### अगर fail हो तो fallback
Editor न खुले → GitHub/branch `feat/mvp-1` पर फ़ाइलें, या इस doc की table पढ़कर समझाएँ।

---

## 4. Claude workflow demo (4 मिनट)

दिखाने का क्रम:
1. `CLAUDE.md` — non-negotiable नियम (stack, Zod, migrations, "बिना चलाए pass मत कहो")।
2. `.claude/commands/` — `requirement.md`, `execute.md` आदि slash commands।
3. `.claude/agents/` — `planner`, `executor-high`, `executor-medium`, `executor-low`, `code-reviewer`,
   `security-reviewer`, `test-engineer`।
4. `requirements/sessions-and-join/requirement.md` — `/requirement` का output: business भाषा में 13 behaviours,
   10 success criteria, scope, risks।
5. `requirements/sessions-and-join/planning-tracking.md` — `/execute` का output:
   - Plan v1: architecture, 13 key decisions, contracts table, files table, impact analysis।
   - **Approval gate:** "Approvals needed" (A1 packages: कोई नहीं; A2 test database; A3 destructive `down`) और
     "Decisions (resolved 2026-10-24)"। Plan मंज़ूर होने से पहले कोई code नहीं।
   - **Execution groups G1–G9:** काम की जटिलता के हिसाब से `executor-high` / `executor-medium` / `executor-low`।
   - Tasks table: 14 tasks, हर एक का status और verification note।
   - Issues: 31 vs 32 alphabet की गलती, join-vs-end race bug, dev DB migrate नहीं था।

### CTO को क्या बोलें
"Claude को खुला नहीं छोड़ा। पहले business requirement बनती है, फिर planner plan लिखता है, मैं approve करता हूँ,
फिर executors groups में बनाते हैं और हर task के बाद verify होता है। सब कुछ एक tracking फ़ाइल में दर्ज है —
गलतियाँ भी। जैसे plan में alphabet 32 लिखा था, असल में 31 है; यह पकड़ा गया और दर्ज हुआ। Task 1 के note में साफ़
लिखा है कि executor ने requirement पढ़े बिना spec से बनाया — 'verified (partial)'। हम कमज़ोरी छिपाते नहीं।"

### अगर fail हो तो fallback
Claude Code live न चले → सिर्फ़ फ़ाइलें दिखाएँ; यही असली output है। `docs/claude-workflow/09-worked-example.md` भी है।

---

## 5. Tests दिखाना (2 मिनट)

Commands (Terminal 4):
- `npm test` — सभी workspaces के unit tests (database नहीं चाहिए)।
- `npm run test:integration -w api` — असली PostgreSQL पर Supertest। ज़रूरी: `livepulse_test` database और
  `TEST_DATABASE_URL`। Suite तभी चलता है जब `NODE_ENV=test` हो और database का नाम `_test` पर ख़त्म हो।
- `npm run typecheck` और `npm run lint`।

दर्ज नतीजे (planning-tracking.md, final verify, 2026-10-24):
**lint 0 · typecheck 0 · unit 49 pass · web 35 pass · integration 58 pass।**
Demo के दिन नतीजे वही बोलें जो screen पर दिखें।

Integration फ़ाइलें: `sessions`, `join`, `presenter-access`, `presenter-key-secrecy`, `rate-limit`,
`sessions-service`, `participants-service`, `models`, `app`, `readiness-real` (`api/tests/integration/`)।

### CTO को क्या बोलें
"Integration tests असली Postgres पर चलते हैं, mock पर नहीं — इसलिए constraints, locks और race सच में test होते
हैं। Test-DB guard dev database को कभी नहीं छूने देता। हर success criterion पर कम से कम एक test है।"

### अगर fail हो तो fallback
- Integration suite DB न मिलने पर मना करे → यह guard का सही व्यवहार है; `npm test` (unit) दिखाएँ।
- कोई test fail हो → सच बताएँ, `/fix-test` workflow का ज़िक्र करें। "pass हुआ" तभी कहें जब देखा हो।

---

## 6. Architecture बताना (2 मिनट)

```
Browser (Next.js App Router)
   │  fetch, credentials: 'include'  (cookies)
   ▼
Express API  /api/sessions/*
   route → rate-limit → origin-check → Zod validate → controller → service → Sequelize model
   ▼
PostgreSQL (source of truth: constraints, locks)      Redis (अभी सिर्फ़ readiness; बाद में Socket.IO adapter)
```

### CTO को क्या बोलें
"Modular monolith (एक deploy, अंदर साफ़ परतें)। `shared/` में Zod schemas हैं जो API और web दोनों use करते हैं,
इसलिए contract एक जगह। PostgreSQL सच का एकमात्र स्रोत है। Realtime आने पर नियम होगा: पहले persist, commit, फिर
emit; Redis Pub/Sub durable नहीं है, इसलिए reconnect पर client HTTP से दोबारा data लेगा। Rate limiting अभी
in-memory, per process है — कई instances पर Redis store लगेगा।"

### Fallback
`docs/02-architecture.md` स्क्रीन पर खोलें।

---

## 7. आगे क्या (2 मिनट)

Roadmap (`docs/08-implementation-plan.md`) के अनुसार अगला काम, **अभी कुछ नहीं बना**:
1. **Realtime backbone** — Socket.IO + Redis adapter, live count, reconnect पर snapshot।
2. **Polls / word cloud / Q&A / reactions** — voting में `(poll_id, participant_id)` unique + row lock।
3. **AI co-pilot (Phase 9+)** — Claude via LangChain.js, LangGraph Q&A flow, local embeddings, pgvector, MCP server।
   AI सिर्फ़ draft बनाता है, presenter approve करता है; tests `fake` provider से, बिना network।

### CTO को क्या बोलें
"अभी foundation और sessions बने हैं। AI का architecture document में तय है, code में नहीं। मैं वही दिखा रहा हूँ
जो चलता है।"

---

## ईमानदार सीमाएँ (Honest limits) — demo में ज़रूर बोलें
- **Real browser test अभी नहीं हुआ।** Task 14 HTTP पर अलग cookie jars से 12 steps में check हुआ, असली browser में
  नहीं। Ports 3000/4000 के बीच cookie, clipboard copy, end-confirmation click flow — verify नहीं।
- **AI बिल्कुल नहीं बना** (Phase 9+)। Realtime और polls भी नहीं।
- Join-vs-end race test हर run में दोनों रास्ते (rejected और accepted) hit करता है, यह verify नहीं।
- Rate limit per process, in-memory।
- Foundation phase की 3 high/critical npm advisories बाकी हैं (major upgrades चाहिए)।
- कोई security audit या load test नहीं हुआ; capacity का कोई दावा नहीं।
- Same browser के दो tabs एक साथ join करें तो दो participants बन सकते हैं (स्वीकार और दर्ज)।
