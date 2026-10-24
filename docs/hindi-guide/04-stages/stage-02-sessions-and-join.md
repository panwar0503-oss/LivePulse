# Stage 02 — Sessions and Join (सेशन बनाना और जुड़ना)

> स्रोत (source): `requirements/sessions-and-join/requirement.md` और
> `requirements/sessions-and-join/planning-tracking.md`। यहाँ जो लिखा है वह इन्हीं दो files और असली code से लिया
> गया है। जहाँ बात इन files में दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. यह stage क्या है — एक लाइन में

Presenter (प्रस्तुतकर्ता) एक live session बनाता है और उसे 6 अक्षरों का **room code** मिलता है। Audience
(दर्शक) उस code और अपने नाम से जुड़ते हैं। Presenter session ख़त्म कर सकता है, और ख़त्म होने के बाद कोई नया
व्यक्ति नहीं जुड़ सकता। यह LivePulse roadmap का **Phase 3** है (`docs/08-implementation-plan.md`)।

### Git की स्थिति (commit)

`git log --oneline` चलाने पर ये commits दिखे:

```
f382ca2 Add project foundation: monorepo, API core, health checks, web shell
708abec Add product docs and plain-English Claude workflow guide
e5dce2d added initial claude workflows
```

यानी **sessions-and-join का code अभी commit नहीं हुआ है।** `git status` में इसकी files untracked (`??`) या
modified (`M`) दिख रही हैं — जैसे `api/src/services/sessions.service.ts`, `api/migrations/...cjs`,
`requirements/sessions-and-join/`। सबसे नया commit `f382ca2` foundation (पिछला stage) का है।

---

## 2. Requirement (ज़रूरत) — व्यापार की भाषा में

File: `requirements/sessions-and-join/requirement.md` (Status: `completed`)।

### कौन इस्तेमाल करता है
- **Presenter** — session बनाता है, code बाँटता है, status और जुड़े लोगों की गिनती देखता है, session ख़त्म करता है।
- **Participant** (प्रतिभागी) — code और नाम से जुड़ता है; page refresh करने पर भी वही पहचान रहती है।
- **Visitor** (आगंतुक) — landing page खोलने वाला कोई भी; session बना सकता है या join page पर जा सकता है।

### Key behaviours (मुख्य व्यवहार) 1–13

| # | व्यवहार (हिंदी में) | Notes |
|---|---|---|
| 1 | Session बनाने के लिए सिर्फ़ title चाहिए; description वैकल्पिक (optional) है | Title trim के बाद 1–80 अक्षर; description 500 तक |
| 2 | Session बनते ही room code, join link और presenter key **एक बार** दिखते हैं | Key दोबारा नहीं दिखेगी; presenter को save करने को कहा जाता है |
| 3 | जिस browser से session बना, वह presenter के रूप में पहचाना जाता है | उस browser में key दोबारा नहीं चाहिए |
| 4 | दूसरे device पर presenter key **एक बार** डालकर session खोल सकते हैं | ग़लत key पर साफ़ error; और कुछ नहीं बताया जाता |
| 5 | Room code unique हैं और मिलते-जुलते (look-alike) अक्षर नहीं होते | 31 अक्षरों के set से 6 अक्षर; 0, O, 1, I, L नहीं |
| 6 | जुड़ने के लिए valid room code और display name चाहिए | Display name trim के बाद 1–30 अक्षर |
| 7 | Unknown या ended session पर एक ही generic संदेश: "not found or not open" | अंदाज़ा लगाने वालों को पता न चले कि कौन सा code मौजूद है |
| 8 | Participant की पहचान उस browser में **सिर्फ़ उसी session** के लिए रहती है | दूसरे sessions उसे इस्तेमाल नहीं कर सकते |
| 9 | Page refresh करने पर participant का view वापस आता है | दूसरा join नहीं बनता |
| 10 | Public lookup सिर्फ़ title, status और code दिखाता है | Presenter key, participant list या internal IDs कभी नहीं |
| 11 | Presenter dashboard: status, title, code, join link, और जुड़े लोगों की गिनती | गिनती "जो जुड़े" उनकी है, "अभी online" की नहीं |
| 12 | Session ख़त्म करना अंतिम (final) है | Ended session नए join ठुकराता है; दो बार ख़त्म करना हानिरहित |
| 13 | एक ही source से बार-बार join की कोशिश सीमित (limited) है | साफ़ संदेश: "too many attempts, try again shortly" |

### User flows (उपयोग का क्रम)
1. **Presenter session बनाता है** — landing → Create → title डालो → code, link, key दिखते हैं (key एक बार) → dashboard।
2. **Participant जुड़ता है** — join page (या join link, जिसमें code पहले से भरा है) → code + नाम → session view → refresh पर वही पहचान।
3. **Presenter दूसरे device से लौटता है** — presenter page key माँगता है → सही key पर dashboard; ग़लत key पर साफ़ error।
4. **Presenter session ख़त्म करता है** — End session → confirm → dashboard पर ended state → नए join generic संदेश से ठुकराए जाते हैं।

### Edge cases (किनारे के मामले)
- दो लोग एक ही नाम रखें → अनुमति है।
- Room code पहले से मौजूद code से टकराए → system कुछ बार retry करता है, फिर safe error।
- Key spaces के साथ paste हो → trim करके स्वीकार।
- Session ख़त्म होने के बाद join link खुले → join page पर साफ़ "ended" संदेश।

### Real-time
इस phase में **कोई real-time नहीं**। Presenter की गिनती और status page refresh पर अपडेट होते हैं।

### Scope से बाहर
Live presence, polls/Q&A/reactions, ended session दोबारा खोलना, user accounts, title edit, participants हटाना,
final results page।

### Success criteria (सफलता की कसौटी) 1–10
1. Presenter session बनाता है और unique room code, join link, presenter key **एक बार** देखता है।
2. दो अलग browsers एक ही session में code और अलग-अलग नामों से जुड़ सकते हैं।
3. Refresh करने पर participant उसी पहचान के साथ session में रहता है; दूसरा browser नहीं।
4. ग़लत room code पर validation या not-found संदेश, बिना दूसरे sessions की जानकारी दिए।
5. दो लोगों के जुड़ने के बाद dashboard सही गिनती (2) दिखाता है।
6. नए browser से presenter page बिना key के मना करता है, सही key पर स्वीकार करता है।
7. ख़त्म करने के बाद join generic संदेश से मना; दोबारा ख़त्म करने से कुछ नहीं बदलता।
8. Rate limits "too many attempts" संदेश लौटाते हैं।
9. Public lookup कभी presenter key या participant list नहीं लौटाता।
10. Presenter key किसी URL, log line या error response में नहीं दिखती।

---

## 3. Clarification (स्पष्टीकरण) — 4 सवाल और जवाब

Requirement के change log (line 158) में दर्ज है: *"Created and confirmed (presenter cookie + key on other
devices; participant cookie; 6-character codes; ending is final)"*। Assumptions 1–4 में इनके कारण लिखे हैं।

| # | सवाल | जवाब (developer ने चुना) | कारण |
|---|---|---|---|
| 1 | Presenter की पहचान कैसे हो? | बनाने वाले browser में एक secure, session-scoped **cookie**; दूसरे device पर presenter key **एक बार** डालनी होगी | Key कभी URL या page-readable storage (जैसे `localStorage`) में नहीं रहती। `docs/04` और `docs/06` में पहले bearer-header वाला तरीका था; उन्हें बदला गया। |
| 2 | Participant की पहचान कैसे हो? | एक secure, session-scoped **HttpOnly cookie** | Page की JavaScript इसे पढ़ नहीं सकती (XSS से बचाव) |
| 3 | Room code कैसा हो? | **6 अक्षर**, 31 अक्षरों के set से, बिना look-alike | लगभग 10^9 combinations; rate limit के साथ अंदाज़ा लगाना कठिन |
| 4 | क्या ख़त्म session फिर खुल सकता है? | नहीं — **ending is final** (MVP के लिए) | सरलता |

बाक़ी assumptions: dashboard गिनती = जुड़े हुए लोग (live presence नहीं); rate limits — 10 creations/IP/घंटा,
20 joins/IP/मिनट, 10 presenter-key attempts/session/15 मिनट; नाम दोहराए जा सकते हैं।

---

## 4. Planner का Plan v1

File: `planning-tracking.md`, section "Plan (v1)"।

### Architecture (ढाँचा)
- **DB:** `sessions` table (uuid id, unique `room_code char(6)`, `title`, `description`, unique
  `presenter_key_hash char(64)`, `status` enum `ACTIVE|ENDED`, `ended_at`, timestamps) और एक CHECK —
  `(status='ENDED') = (ended_at IS NOT NULL)`। `participants` table (uuid id, `session_id` FK → sessions
  `ON DELETE CASCADE`, `display_name`, unique `token_hash`, `last_seen_at`) + `session_id` पर index।
- **API:** `/api/sessions/*` → validate (Zod) → controller → service → models। Middleware: in-memory rate-limit,
  POST पर origin-check, cookie पढ़ना/लिखना।
- **Web:** page → `lib/api/sessions.ts` (`fetch`, `credentials: 'include'`) → presentational components।

### Key decisions (मुख्य फ़ैसले) 1–13 — संक्षेप में
1. Feature routes का base path `/api`; health root पर ही।
2. Join और restore **room code से** (`/by-code/:code/join`), session id से नहीं — ताकि public lookup internal ID न दिखाए।
3. Per-session cookies, `Path=/api`: `lp_presenter_<sessionId>`, `lp_participant_<sessionId>`; `HttpOnly; SameSite=Lax; Max-Age=7d`; `Secure` सिर्फ़ production में।
4. Cookie में raw random token (32 bytes, base64url); DB में सिर्फ़ उसका `sha256`। 256-bit entropy पर बिना salt का SHA-256 सुरक्षित; bcrypt/argon2 सिर्फ़ एक नया package जोड़ता।
5. Presenter: `crypto.timingSafeEqual` से hash तुलना। Participant: unique `token_hash` से खोजो, फिर `session_id` मिलाओ, वरना 401।
6. Room code `crypto.randomInt` से; 5 कोशिशें; हर कोशिश transaction के बाहर अलग INSERT; सिर्फ़ `room_code` unique violation पर retry; वरना `500 ROOM_CODE_UNAVAILABLE`।
7. Rate limiting घर में बनाया (in-memory fixed window, injectable clock, `req.ip` key)। कई instances होने पर Redis store लगेगा।
8. इस phase में `/state` endpoint नहीं; गिनती `GET /api/sessions/:id` में।
9. CSRF बचाव: SameSite=Lax, JSON-only body, और origin check (ग़लत `Origin` पर 403 `FORBIDDEN_ORIGIN`)।
10. CORS `credentials: true` सिर्फ़ explicit `WEB_ORIGIN` list के साथ, कभी `*` नहीं।
11. Join link `${WEB_ORIGIN[0]}/join?code=XXXXXX`, API बनाता है।
12. Web API base URL `NEXT_PUBLIC_API_URL` से (Zod-checked)।
13. उसी browser से वैध cookie के साथ दोबारा join → पुराना participant, `200`; पहला join `201`।

### Contracts (HTTP endpoints)

| Endpoint | कौन | सफलता | Errors |
|---|---|---|---|
| `POST /api/sessions` | Public, 10/IP/घंटा | `201 {sessionId, roomCode, joinUrl, presenterKey}` + presenter cookie | 400 · 403 · 429 · 500 ROOM_CODE_UNAVAILABLE |
| `GET /api/sessions/by-code/:code` | Public, join bucket | `200 {title, status, roomCode}` | 400 · 404 · 429 |
| `POST /api/sessions/by-code/:code/join` | Public, 20/IP/मिनट | `201` (या `200`) + participant cookie | 400 · 403 · 404 SESSION_NOT_OPEN · 429 |
| `GET /api/sessions/by-code/:code/participant-me` | Participant cookie | `200` | 400 · 401 PARTICIPANT_AUTH_REQUIRED · 404 |
| `GET /api/sessions/:id` | Presenter cookie | `200` presenter DTO (participantCount सहित) | 400 · 401 PRESENTER_AUTH_REQUIRED · 404 |
| `POST /api/sessions/:id/presenter-access` | Public, 10/session/15 मिनट | `204` + presenter cookie | 400 · 401 INVALID_PRESENTER_KEY · 403 · 404 · 429 |
| `POST /api/sessions/:id/end` | Presenter cookie | `200`; दोबारा भी `200`, `ended_at` नहीं बदलता | 400 · 401 · 403 · 404 |

### Impact analysis (असर का विश्लेषण)
- **Breaking:** `createApp` को नई `sequelize` dependency चाहिए; CORS `credentials: true`; landing page test बदला।
- **Migration:** पहला schema, additive (सिर्फ़ जोड़ना)। लेकिन `down` **सारा session/participant data मिटा देता है** — सिर्फ़ dev/test पर ठीक।
- **Concurrency (एक साथ चलने वाले काम):** room-code टकराव पर retry; join बनाम end के लिए `FOR SHARE` lock; एक ही browser के दो tabs एक साथ join करें तो दो participants बन सकते हैं — स्वीकार किया गया और लिखा गया।
- **Testing:** integration suite तभी चलेगा जब `NODE_ENV=test`, `TEST_DATABASE_URL` set हो और database का नाम `_test` पर ख़त्म हो।

---

## 5. Open questions और approval का फ़ैसला

Change log (line 186): *"Plan v1 drafted by planner; awaiting approval (open questions 1–6, approvals A1–A3)"*।
Tracking file में open questions 1–6 का पूरा मूल पाठ नहीं बचा है — सिर्फ़ उनके resolved फ़ैसले दर्ज हैं
(सवाल 2–6 के शब्द: पुष्टि नहीं हुई)। Plan में "Open question 1" का ज़िक्र है: by-code routes `docs/04` से अलग हैं।

### Approvals needed
- **A1 — Packages:** कोई नया package नहीं। `cookie-parser` और `express-rate-limit` की जगह built-in code।
- **A2 — Test database:** local Postgres में `livepulse_test` बनाना (एक `createdb`, docs/09 में लिखा)।
- **A3 — Destructive `down` migration:** असली data वाली जगह चलाने से पहले approval।

### Decisions (2026-10-24 को तय)
1. **Join और restore room code से** — docs/04 अपडेट होगा।
2. **Public lookup join bucket साझा करता है** (20/IP/मिनट)।
3. **Test database हाथ से बनाया** (`livepulse_test`, local container में)।
4. **Plan v1 approved**, defaults के साथ: 7-दिन cookies, `Secure` सिर्फ़ production में, in-memory per-process rate limiting, कोई नया package नहीं; destructive `down` सिर्फ़ test DB पर।

---

## 6. Execution groups (G1–G9) और हर task क्या बना

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
| G9 | 14 | inline (manual check) |

### Tasks (v1) — क्या बना और स्थिति

| # | Task | क्या बना | Status / notes |
|---|---|---|---|
| 1 | Shared schemas | `shared/src/schemas/sessions.ts` — alphabet, room code, title, description, display name, presenter key schemas; DTO schemas | verified (partial): shared 28 tests (18 नए); executor ने requirement पढ़े बिना spec से बनाया — review बाक़ी |
| 2 | Env + test-DB guard + global setup | `TEST_DATABASE_URL`, `TRUST_PROXY`; `api/tests/helpers/test-db.ts`; `api/tests/global-setup.ts`; `db:migration:generate` script | verified: 15 unit tests; dev DB और non-`_test` नाम ठुकराए जाते हैं |
| 3 | Migration | `api/migrations/20261024034903-create-sessions-and-participants.cjs` | verified: `livepulse_test` पर up, down, up; constraints और cascade पक्के; duplicate room code ठुकराया |
| 4 | Models | `session.model.ts`, `participant.model.ts`, `models/index.ts` (`initModels`) | verified: 5 model integration tests |
| 5 | Libs | `tokens.ts`, `room-code.ts`, `cookies.ts` + unit tests | verified: unit suite 37 pass; alphabet 31 (plan में 32 था — सुधारा) |
| 6 | Middleware | `validate.ts`, `rate-limit.ts`, `origin-check.ts` | verified: 12 नए unit tests |
| 7 | Sessions service | create with retry, get, end, presenter access | verified: race test ने `ended_at` ordering bug पकड़ा; `endSession` locking transaction में गया |
| 8 | Participants service | `FOR SHARE` के साथ join, me | verified: join-vs-end race test pass; उसी browser से rejoin पुराना participant लौटाता है |
| 9 | Controller, routes, wiring | `sessions.controller.ts`, `sessions.routes.ts`, `app.ts`/`server.ts`, CORS credentials | verified: integration 58/58 pass |
| 10 | Web config + API client | `web/src/lib/config.ts`, `web/src/lib/api/sessions.ts` | verified; `next.config.ts` में shared के लिए `transpilePackages` |
| 11 | Landing, create, join pages | `/create`, `/join` pages + components | verified: build में `/create` और `/join` दिखे |
| 12 | Presenter और participant page | `presenter/[sessionId]`, `session/[roomCode]` | verified; `INVALID_PRESENTER_KEY` अब explicitly map |
| 13 | Docs | docs/03, 04, 06, `.env.example`, tracking | verified; prettier ने docs/04 का whitespace बदला |
| 14 | Two-browser HTTP check | अलग cookie jars के साथ HTTP flow | verified (partial): 12-step flow pass; **असली browser नहीं** |

ध्यान दें: plan में `presenter-auth.ts` और `participant-auth.ts` middleware भी लिखे थे, पर ऐसी files नहीं बनीं —
cookie पढ़ना controller (`readCookie`) में और जाँच services में है। (यह विचलन tracking file में अलग से दर्ज नहीं है।)

---

## 7. Bugs और issues जो मिले

Tracking file का "Issues & updates" section स्रोत है।

### 7.1 `ended_at` race (HIGH) — race test ने पकड़ा
**समस्या:** पहले `endSession` एक साधारण `UPDATE` था। Code comment (line 96) के अनुसार साधारण `UPDATE` में end
time lock का इंतज़ार करने से **पहले** तय हो जाता है। अगर कोई join उसी समय `FOR SHARE` lock पकड़े था, तो end रुकता,
join commit होता, फिर end commit होता — लेकिन `ended_at` का समय participant के `created_at` से **पहले** का
निकल सकता था। यानी रिकॉर्ड कहता "session 10:00:00.100 पर ख़त्म हुआ" जबकि participant 10:00:00.150 पर जुड़ा।

**Fix:** `endSession` अब transaction में चलता है, पहले `SELECT ... FOR UPDATE` से row lock करता है (in-flight joins
का इंतज़ार), और lock मिलने **के बाद** `new Date()` लेता है (`api/src/services/sessions.service.ts` lines 94–107)।
दोबारा चलाया — green।

### 7.2 31 बनाम 32 alphabet (MEDIUM)
Requirement और plan में "32 अक्षर" लिखा था। लेकिन A–Z (26) + 0–9 (10) = 36 में से 0, O, 1, I, L हटाओ तो **31**
बचते हैं। Code alphabet shared से पढ़ता है (`ABCDEFGHJKMNPQRSTUVWXYZ23456789`), जो सही है; requirement और plan
को सुधारा गया।

### 7.3 Dev database migrate नहीं था (MEDIUM)
`livepulse` (dev DB) में sessions tables नहीं थीं, इसलिए API 500 देता था। हल: dev DB पर `npm run db:migrate`
(सिर्फ़ up)। हर नए database पर एक बार ज़रूरी।

### 7.4 `INVALID_PRESENTER_KEY` mapping
Task 12 note: main session ने web पर `INVALID_PRESENTER_KEY` को explicitly map किया।
`web/src/components/sessions/PresenterKeyForm.tsx` में `presenterKeyErrorText` का `switch` (line 18) इस code को
"That presenter key is not valid." संदेश देता है। पहले switch में सिर्फ़ `UNAUTHORIZED` और `VALIDATION_ERROR` थे।
API का `INVALID_PRESENTER_KEY` default branch में जाता था, और वहाँ API का अपना message दिखता था, जो संयोग से
वही शब्द था। इसलिए code को explicit किया गया, ताकि message API के wording बदलने पर भी सही रहे।

### 7.5 छोटे (LOW) issues
- Race test हर run में rejected और accepted दोनों रास्ते शायद न छुए — deterministic ordering test बाद में।
- Prettier ने docs/04 की tables re-align कीं (सिर्फ़ whitespace, इस feature के बाहर के हिस्से भी)।
- docs/04 की error-code list में FORBIDDEN_ORIGIN, PRESENTER_AUTH_REQUIRED, PARTICIPANT_AUTH_REQUIRED,
  INVALID_PRESENTER_KEY, SESSION_NOT_OPEN, ROOM_CODE_UNAVAILABLE अभी नहीं जोड़े गए।
- Next build warning: "Next.js plugin was not detected in your ESLint configuration" — build pass, बाद में ठीक करना।
- **RISK:** foundation phase की 3 high/critical npm advisories बाक़ी (major upgrades चाहिए)।

---

## 8. Verification — असल में क्या चला

Change log (line 189) के अनुसार final run:

| Check | नतीजा |
|---|---|
| lint | 0 (कोई error नहीं) |
| typecheck | 0 |
| unit tests (api) | 49 pass |
| web tests | 35 pass |
| web build | 0 (सफल) |
| prettier | 0 |
| integration tests (असली Postgres, `livepulse_test`) | 58 pass |

(ये नतीजे tracking file से हैं। यह document लिखते समय ये commands दोबारा नहीं चलाए गए।)

---

## 9. HTTP two-browser flow — 12 steps

Task 14: "Two-browser check over HTTP with separate cookie jars" — **12-step flow passes; NOT a real browser**।
दो अलग cookie jars (cookie के डिब्बे) दो browsers की नक़ल करते हैं।

**सावधानी:** tracking file में सिर्फ़ इतना दर्ज है कि 12 steps pass हुए; हर step का अलग-अलग पाठ दर्ज **नहीं** है
(पुष्टि नहीं हुई)। Requirement के change log (line 159) के अनुसार इस flow ने success criteria 1–10 को सहारा दिया।
नीचे की सूची success criteria और contracts से बनी एक **संभावित** रूपरेखा है, असली step list नहीं:

| संभावित step | क्या जाँचा जाता | अपेक्षित नतीजा |
|---|---|---|
| Presenter jar: `POST /api/sessions` | session बनाना | 201 + presenter cookie |
| Public `GET /by-code/:code` | lookup | सिर्फ़ title, status, roomCode |
| Browser A: join | पहला participant | 201 + participant cookie |
| Browser B: join | दूसरा participant | 201 |
| A: `participant-me` | refresh | 200, वही नाम |
| बिना cookie वाला jar: `participant-me` | बिना पहचान | 401 |
| Presenter: `GET /api/sessions/:id` | dashboard | participantCount = 2 |
| नया jar: `GET /api/sessions/:id` | बिना key | 401 |
| नया jar: `presenter-access` सही key | key से पहुँच | 204 + cookie |
| Presenter: `end` | ख़त्म | 200, status ENDED |
| नया join | ended पर join | 404 SESSION_NOT_OPEN |
| दोबारा `end` | idempotent | 200, `endedAt` वही |

नतीजा (tracking के अनुसार): **सभी 12 steps pass**।

---

## 10. "पुष्टि नहीं" (Not verified) वाली चीज़ें

Tracking file (line 176–177) साफ़ कहती है कि ये **नहीं** जाँचा गया:

1. **असली browser में cookies** — port 3000 (web) और 4000 (API) के बीच cookie व्यवहार सिर्फ़ HTTP से जाँचा, असली browser में नहीं।
2. **`TRUST_PROXY`** — किसी असली reverse proxy के पीछे नहीं जाँचा।
3. **Clipboard copy** — key copy button असली browser में नहीं जाँचा।
4. **End confirmation click flow** — "End session" → confirm वाला click असली browser में नहीं जाँचा।

इसके अलावा: race test हर बार दोनों रास्ते छूता है या नहीं — पुष्टि नहीं; task 1 का review बाक़ी।

---

## 11. आगे क्या

अगला phase realtime-backbone है (live updates, presence)। शुरू करने के लिए developer की स्पष्ट approval चाहिए।
Backend code की file-by-file व्याख्या: [`../05-code/03-api-sessions.md`](../05-code/03-api-sessions.md)।
