# 08 — Verification log (जाँच का इतिहास)

यह file बताती है कि हर चरण (phase) में **क्या-क्या जाँचा गया**, किस command से, और नतीजा क्या आया।

**स्रोत (source):** सिर्फ़ ये दो tracking files —
- `requirements/foundation/planning-tracking.md`
- `requirements/sessions-and-join/planning-tracking.md` (और `requirements/sessions-and-join/requirement.md` line 159)

जो बात इन files में दर्ज नहीं है, उसे यहाँ "(पुष्टि नहीं हुई)" या "दर्ज नहीं" लिखा है। यह guide लिखते समय
कोई command दोबारा **नहीं** चलाया गया — नीचे के नतीजे वही हैं जो tracking में लिखे हैं।

शब्द: **exit code** = command ख़त्म होने पर लौटाया गया अंक; `0` मतलब सफल। **healthy** = Docker
healthcheck pass। **migration up/down** = schema लगाना / वापस हटाना।

---

## 1. Foundation (चरण: project skeleton)

**तारीख:** 2026-10-23 को files लिखी गईं, पर उस दिन machine पर Node/npm/Docker नहीं थे, इसलिए कुछ नहीं
चला (foundation tracking line 120-123)। **सारी जाँच 2026-10-24** को हुई, Node 24 और Docker 29 के साथ
(line 129)।

| # | क्या जाँचा | Command | नतीजा (tracking के अनुसार) | स्रोत line |
|---|---|---|---|---|
| F1 | Dependencies install | `npm install` | सफल; 9 vulnerabilities की रिपोर्ट (5 moderate, 2 high, 2 critical) — ठीक नहीं की गईं | 128, 130-132 |
| F2 | Lint | `npm run lint` | exit 0 | 164 |
| F3 | Formatting | prettier (`npm run format:check`) | pass | 77 |
| F4 | Typecheck | `npm run typecheck` | exit 0 | 164 |
| F5 | Shared tests | `npm test -w shared` | **10 pass** (executor ने 11 बताया था, वह ग़लत था) | 78, 164 |
| F6 | API env unit tests | `npm test -w api` (env file) | **8 env tests pass** | 80 |
| F7 | API पूरा test suite | `npm test -w api` | **22 pass, 2 skipped** (real-DB file बिना env के skip) | 84, 164 |
| F8 | Real-DB readiness test | env set करके वही file | **2 pass** | 84 |
| F9 | Compose config | `docker compose config -q` | exit 0 | 79 |
| F10 | Containers | `docker compose up -d` | postgres और redis दोनों **healthy** | 79 |
| F11 | Migration runner (ख़ाली DB) | `npm run db:migrate` (+ status, undo) | exit 0; migrate/status/undo OK | 82, 164 |
| F12 | Liveness | `GET /health` | **200** | 83, 164 |
| F13 | Readiness | `GET /ready` | **200** | 83, 164 |
| F14 | Redis बंद | `docker compose stop redis` → `GET /ready` | **503**, `redis:down`; `start` के बाद बिना restart **200** | 83, 164 |
| F15 | Postgres बंद | postgres stop → `GET /ready` | **503**, `postgres:down`; वापस 200 | 83 |
| F16 | Redis बंद रहते API start | `npm run dev -w api` | process **exit 1**, साफ़ message | 82 |
| F17 | Web | typecheck, `npm test -w web` | **2 tests pass** | 85, 164 |
| F18 | Web build बिना env | `npm run build -w web` | exit 0 | 85 |
| F19 | Web dev server | `npm run dev -w web` | **200** | 85 |
| F20 | `.env` loading | `npm run dev:api` बिना inline env | `/health` और `/ready` 200/200 | 133-136 |
| F21 | 404/400 envelopes, CORS | (Supertest + हाथ से) | checked; 413 test task 8 में | 81 |

### Foundation में जो verify **नहीं** हुआ (line 148-149)
- SIGINT/SIGTERM पर graceful shutdown (सिर्फ़ `taskkill /F` आज़माया गया)।
- Unhandled rejection / exception handlers।
- अटकी हुई dependency पर readiness का 1 s timeout।

---

## 2. Sessions-and-join (चरण: session बनाना और join करना)

**तारीख:** सब 2026-10-24 (tracking change log line 186-189)।

### 2.1 Test database और migration

| # | क्या | Command | नतीजा | स्रोत |
|---|---|---|---|---|
| S1 | Test DB बनाना | `livepulse_test` बनाया (docs/09 का तरीका: `docker compose exec postgres psql -U livepulse -d livepulse -c "CREATE DATABASE livepulse_test;"`) | बना, 2026-10-24, local container में | decision 3 (line 143) |
| S2 | Migration up → down → up | `livepulse_test` पर | तीनों सफल; constraints और cascade पक्के; duplicate room code reject | task 3 (line 121) |
| S3 | Test-DB guard | integration suite | dev DB और `_test` के बिना नाम वाले DB को मना करता है | task 2 (line 120) |
| S4 | Dev DB migrate (सिर्फ़ up) | `npm run db:migrate` | पहले API 500 दे रहा था (tables नहीं थीं); up चलाने के बाद ठीक | line 166-167 |

S1 का हूबहू command tracking में दर्ज नहीं है ("one `createdb`") — ऊपर लिखा command docs/09 line 77 का है
(पुष्टि नहीं हुई कि यही चलाया गया)। S2 के हूबहू commands भी दर्ज नहीं (पुष्टि नहीं हुई)।
Destructive `down` सिर्फ़ test DB पर चला (decision 4, line 144-145)।

### 2.2 Tasks के हिसाब से जाँच

| Task | क्या | नतीजा (line) |
|---|---|---|
| 1 | Shared schemas | shared **28 pass** (18 नए); typecheck, lint, prettier pass (119) |
| 2 | Env, test-DB guard | **15 unit tests** (120) |
| 4 | Models | **5 model integration tests** pass (122) |
| 5 | tokens, room-code, cookies | unit suite **37 pass**; alphabet 31 अक्षर (32 नहीं) (123) |
| 6 | validate, rate-limit, origin-check | **12 नए unit tests** (124) |
| 7 | Sessions service | race test ने `ended_at` ordering bug पकड़ा; ठीक करके फिर हरा (125, 163-165) |
| 8 | Participants service | join-vs-end race test pass; same-browser rejoin पुराना participant लौटाता है (126) |
| 9 | Routes, auth, wiring | integration **58 / 58 pass** (main session ने दोबारा चलाया) (127) |
| 10-12 | Web client, pages | web tests pass; build में `/create`, `/join` और dynamic presenter/session routes (128-130) |
| 13 | Docs | prettier ने docs/04 का whitespace बदला (131, 170-171) |
| 14 | HTTP 12-step flow | pass, पर **असली browser नहीं** (132) |

### 2.3 आख़िरी पूरा run (line 189)

| Check | Command | नतीजा |
|---|---|---|
| Lint | `npm run lint` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| API unit | `npm test -w api` | **49 pass** |
| Web | `npm test -w web` | **35 pass** |
| Web build | `npm run build -w web` | exit 0 (warning: "Next.js plugin was not detected in your ESLint configuration", line 174) |
| Prettier | `npm run format:check` | exit 0 |
| Integration | `npm run test:integration -w api` | **58 pass** |

Web के 35 का हिसाब (files पढ़कर गिना): `page.test.tsx` 2 + `config.test.ts` 5 + `sessions.test.ts` 8 +
`sessions-components.test.tsx` 10 + `presenter-components.test.tsx` 8 + `participant-view.test.tsx` 2 = 35।

### 2.4 HTTP flow — असली नतीजे (task 14, 2026-10-24)

यह flow मैंने (मुख्य session) खुद चलाया: API `npm run dev:api` से पोर्ट 4000 पर, dev DB `livepulse` migrated,
और हर "browser" का अपना अलग cookie jar (`curl -c/-b`)। **यह असली browser test नहीं है।**

| Step | क्या किया | असली नतीजा |
|---|---|---|
| 1 | Presenter jar से `POST /api/sessions` | सफल: `sessionId`, `roomCode`, `presenterKey` मिले |
| 2 | Presenter cookie से `GET /api/sessions/:id` | सफल: title "Product Feedback" |
| 3 | Browser A `POST .../by-code/:code/join` ("Alex") | **201** |
| 4 | Browser B `POST .../by-code/:code/join` ("Sam") | **201** |
| 5 | Browser A `GET .../participant-me` (refresh जैसा) | **200**, participant "Alex" |
| 6 | बिना cookie का browser C `GET .../participant-me` | **401** `PARTICIPANT_AUTH_REQUIRED` |
| 7 | Presenter dashboard का `participantCount` | **2** |
| 8 | Presenter `POST /api/sessions/:id/end` | **200** |
| 9 | Ended session में `join` | **404** `SESSION_NOT_OPEN` |
| 10 | Unknown code `ZZZZZZ` पर `join` | **404** `SESSION_NOT_OPEN` (वही message) |
| 11 | Presenter key का ग़लत value `presenter-access` | **401** `INVALID_PRESENTER_KEY` |
| 12 | API server log में presenter key की गिनती | **0** (key log में नहीं आई) |

अलग से (पहले run में): `Origin: https://evil.example` वाला POST → **403** `FORBIDDEN_ORIGIN`।

**पहली कोशिश में क्या टूटा:** step 1 पर 500 `INTERNAL_ERROR` आया, क्योंकि dev DB `livepulse` में
`sessions`/`participants` tables नहीं थीं (सिर्फ़ test DB migrated था)। `npm run db:migrate` (सिर्फ़ `up`) चलाने के
बाद सब सही हुआ। इसी से यह नियम बना: नया DB हो तो पहले migrate करो।

**जाँच नहीं हुई:** असली browser में cookie का व्यवहार (ports 3000↔4000), clipboard copy, end-confirmation का click।

---

## 3. दोबारा चलाने के लिए commands (copy-paste)

Repo root (`C:\Users\dell\LivePulse`) से, Git Bash में। पहले `.env.example` से `.env` बना लें और local values भरें
(`.env` को कभी share/print न करें)।

### 3.1 Setup और foundation
```bash
node --version && npm --version && docker compose version
docker compose config -q && echo "compose config ok"
docker compose up -d
docker compose ps                      # postgres, redis: healthy
npm install
npm run lint
npm run format:check
npm run typecheck
npm test -w shared
npm test -w api                        # unit tests (DB नहीं चाहिए)
npm test -w web
npm run build -w web
```

### 3.2 Database
```bash
# test DB एक बार (docs/09 line 77)
docker compose exec postgres psql -U livepulse -d livepulse -c "CREATE DATABASE livepulse_test;"
# dev DB: सिर्फ़ up
npm run db:migrate -w api
npm run db:migrate:status -w api
# integration suite: global setup ख़ुद test DB migrate करता है (TEST_DATABASE_URL, नाम *_test)
npm run test:integration -w api
```
`npm run db:migrate:undo -w api` **destructive** है (सारा session/participant data मिटाता है) — सिर्फ़ test DB
पर, और सिर्फ़ `DATABASE_URL` को test DB पर point करके; dev DB पर बिना approval नहीं।

### 3.3 API live check (terminal 1: `npm run dev:api`)
```bash
curl -i http://localhost:4000/health          # 200
curl -i http://localhost:4000/ready           # 200
docker compose stop redis
curl -i http://localhost:4000/ready           # 503, redis: down
docker compose start redis
curl -i http://localhost:4000/ready           # कुछ सेकंड में 200, restart के बिना
```

### 3.4 Web dev (terminal 2: `npm run dev:web`)
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/   # 200
```

### 3.5 HTTP flow, दो अलग cookie jars (API चलता हो, dev DB migrated हो)
`Origin` header न भेजने पर origin check उसे जाने देता है (`api/src/middleware/origin-check.ts` line 7, 12)।
```bash
API=http://localhost:4000
P=$(mktemp); A=$(mktemp); X=$(mktemp)        # presenter, attendee, नया jar
R=$(curl -s -c "$P" -H 'Content-Type: application/json' -d '{"title":"Demo"}' $API/api/sessions); echo "$R"
ID=$(echo "$R" | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')
CODE=$(echo "$R" | sed -E 's/.*"roomCode":"([^"]+)".*/\1/')
curl -s -b "$P" $API/api/sessions/$ID; echo
curl -s -o /dev/null -w "%{http_code}\n" $API/api/sessions/$ID            # 401
curl -s $API/api/sessions/by-code/$CODE; echo
curl -s -o /dev/null -w "%{http_code}\n" -c "$A" -b "$A" -H 'Content-Type: application/json' -d '{"displayName":"Asha"}' $API/api/sessions/by-code/$CODE/join   # 201
curl -s -o /dev/null -w "%{http_code}\n" -c "$A" -b "$A" -H 'Content-Type: application/json' -d '{"displayName":"Asha"}' $API/api/sessions/by-code/$CODE/join   # 200
curl -s -b "$A" $API/api/sessions/by-code/$CODE/participant-me; echo
curl -s -o /dev/null -w "%{http_code}\n" -H 'Content-Type: application/json' -d '{"presenterKey":"wrong-key-wrong-key-123"}' $API/api/sessions/$ID/presenter-access   # 401
curl -s -b "$P" -X POST $API/api/sessions/$ID/end; echo
curl -s -b "$P" -X POST $API/api/sessions/$ID/end; echo                  # फिर 200, endedAt वही
curl -s -o /dev/null -w "%{http_code}\n" -c "$X" -H 'Content-Type: application/json' -d '{"displayName":"Late"}' $API/api/sessions/by-code/$CODE/join   # 404
```
(यह script इस guide के लिए लिखी गई है और यहाँ चलाई नहीं गई — पुष्टि नहीं हुई। रेट limit: create 10/IP/घंटा।)

---

## 4. नहीं चला / पुष्टि नहीं

**Foundation**
- SIGINT/SIGTERM graceful shutdown; unhandled rejection/exception handlers; hang पर 1 s readiness timeout
  (foundation line 148-149)।
- `@socket.io/redis-adapter` के लिए दूसरा Redis client — जानबूझकर बाद में (line 150-151)।
- `npm audit` की 9 vulnerabilities ठीक नहीं की गईं (line 130-132); sessions phase में भी 3 high/critical बाक़ी
  (sessions line 178)।

**Sessions-and-join**
- असली browser में ports 3000 ↔ 4000 के बीच cookie व्यवहार (सिर्फ़ curl जैसे HTTP से जाँचा) (line 176)।
- असली proxy के पीछे `TRUST_PROXY` (line 176-177)।
- Clipboard copy (line 177)।
- Browser में end-confirmation का click flow (line 177)।
- Join-vs-end race test हर run में दोनों रास्ते (reject और accept) छूता है या नहीं — पक्का नहीं (line 168-169)।
- HTTP 12-step flow के हर step का नतीजा दर्ज नहीं (सिर्फ़ "passes")।
- Test DB बनाने और migration up/down/up के हूबहू commands दर्ज नहीं।
- Task 1 executor ने requirement पढ़े बिना spec से बनाया — review बाक़ी (line 119)।
- docs/04 की error-code list में नए codes नहीं जुड़े (line 172-173)।
- Web pages (`create`, `join`, `presenter`, `session`) के अपने tests नहीं हैं; web tests static HTML ही जाँचते हैं।

**इस guide के बारे में**
- इस file में लिखा कोई भी command 2026-10-24 को guide लिखते समय दोबारा नहीं चलाया गया।
