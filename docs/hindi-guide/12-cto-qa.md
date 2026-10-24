# 12 — CTO के संभावित 25 सवाल और जवाब

> नियम: हर जवाब सच्चा। जो अभी **नहीं बना** है, वह साफ़ "अभी नहीं बना" कहा गया है।
> Source: `docs/01`, `docs/04`, `docs/12-demo-and-interview.md`, `requirements/foundation/*`,
> `requirements/sessions-and-join/*`, और नीचे बताई गई code फ़ाइलें।
> दर्ज test नतीजे (2026-10-24): **lint 0 · typecheck 0 · unit 49 · web 35 · integration 58** (सब pass)।

---

## A. मूल्य और दायरा (Value and scope)

### 1. यह product किस काम का है? इसका मूल्य (value) क्या है?
Presenter एक live session चलाता है, audience room code से किसी भी browser से join करती है — कोई account नहीं।
अंतिम लक्ष्य (`docs/01`): polls, word cloud, Q&A, reactions, live updates, और एक AI co-pilot जो presenter की मदद
करे। इस prototype का असली मूल्य दो हैं: (1) engineering की गहराई दिखाना — security, concurrency, tests; (2) यह
दिखाना कि Claude के साथ एक **नियंत्रित workflow** से production जैसी गुणवत्ता का code बन सकता है।

### 2. अभी असल में क्या बना है?
- **Foundation:** npm workspaces (`shared`, `api`, `web`), Docker Compose (PostgreSQL + Redis), Zod env validation,
  error envelope, request id, `/health` और `/ready`।
- **Sessions and join:** session बनाना, room code, presenter key (एक बार दिखती है), दूसरे device पर key से access,
  participant join, refresh पर identity बचना, joined count, end session, rate limits।
- **अभी नहीं बना:** realtime (Socket.IO wired नहीं), polls, Q&A, reactions, AI, MCP।

### 3. यह production-ready क्यों नहीं है?
सच्चे कारण (tracking और `docs/12` से):
- असली browser में test नहीं हुआ — task 14 सिर्फ़ HTTP पर अलग cookie jars से हुआ।
- कोई security audit नहीं, कोई load test नहीं, capacity का कोई दावा नहीं।
- Rate limiting in-memory, per process है।
- Foundation की 3 high/critical npm advisories बाकी हैं।
- Presenter key है, user accounts नहीं; participants anonymous हैं।
- `TRUST_PROXY` असली proxy के पीछे verify नहीं हुआ।
यह जानबूझकर **prototype** है (`CLAUDE.md`)।

---

## B. Scale

### 4. यह कितना scale करेगा?
**कोई संख्या नहीं बताऊँगा, क्योंकि load test नहीं हुआ।** Design scale की दिशा में है: API stateless है (state
PostgreSQL में, identity cookie में), इसलिए कई instances चल सकते हैं। दो चीज़ें बदलनी होंगी: rate limiter का
Redis store (decision 7, planning-tracking.md), और realtime के लिए `@socket.io/redis-adapter` — package
`api/package.json` में है, पर अभी wired नहीं।

### 5. Redis क्यों? अभी तो उसका कोई काम नहीं दिखता।
सही — अभी Redis सिर्फ़ `/ready` check में है, और startup पर Redis न मिले तो API fail fast करता है (foundation
decision 2)। उसका असली काम realtime phase में आएगा: Socket.IO Redis adapter, ताकि instance A पर हुई घटना instance B
के clients तक पहुँचे। नियम पहले से तय है: Redis Pub/Sub durable नहीं, इसलिए पहले PostgreSQL में commit, फिर emit,
और reconnect पर client HTTP से दोबारा data लेगा।

---

## C. Security

### 6. Cookies क्यों, bearer tokens (header) क्यों नहीं?
Cookie `HttpOnly` है — page का JavaScript उसे पढ़ नहीं सकता, तो XSS से token चोरी मुश्किल। Token को
`localStorage` या URL में रखना नहीं पड़ता। Cookies per session हैं: `lp_presenter_<sessionId>` और
`lp_participant_<sessionId>` (`api/src/controllers/sessions.controller.ts` lines 29–30), `Path=/api`, 7 दिन
(lines 26–27)। `api/src/lib/cookies.ts` lines 29–34: हमेशा `HttpOnly; SameSite=Lax`, `Secure` सिर्फ़ production में।
पहले `docs/04` में bearer header था; requirement में यह बदलाव दर्ज है और docs update हुए।

### 7. Cookies से CSRF (दूसरी site से नकली request) का ख़तरा?
तीन परतें: `SameSite=Lax`, सिर्फ़ JSON bodies, और origin check —
`api/src/middleware/origin-check.ts` lines 11–13: POST/PUT/PATCH/DELETE पर अगर `Origin` allowlist में नहीं तो 403
`FORBIDDEN_ORIGIN`। Trade-off (line 7): `Origin` न हो तो request जाने देते हैं ताकि `curl` चले; browsers
cross-site unsafe requests पर हमेशा `Origin` भेजते हैं। CORS `credentials: true` के साथ explicit `WEB_ORIGIN`
list, कभी `*` नहीं।

### 8. कोई room code guess कर ले तो?
Room code **discovery** है, authorization नहीं। 6 अक्षर, 31 अक्षरों का set (0, O, 1, I, L नहीं) — 31^6 लगभग 88.7 करोड़
combinations, `crypto.randomInt` से। ऊपर से:
- Join और public lookup एक ही bucket: 20 प्रयास / IP / मिनट (`api/src/routes/sessions.routes.ts` lines 27–28)।
- Limiter validation से पहले चलता है, तो गलत format वाले codes भी गिने जाते हैं (line 42)।
- Unknown और ended code का एक ही जवाब (`api/src/services/participants.service.ts` lines 23–26)।
- Public lookup सिर्फ़ title, status, code देता है — कोई internal id नहीं।
- Code मिल भी जाए तो presenter pages के लिए presenter key चाहिए।
सीमा: limiter per IP और per process है; कई IPs वाला हमलावर ज़्यादा प्रयास कर सकता है।

### 9. Tokens hash करके क्यों रखते हो? और bcrypt क्यों नहीं?
Database leak हो जाए तो भी असली token नहीं मिलना चाहिए। `api/src/lib/tokens.ts`:
- Line 5: `randomBytes(32)` — 256 bit random token।
- Lines 9–11: SHA-256। Comment (line 8) कारण बताता है: 256 bit entropy पर brute force असंभव है, इसलिए salt या
  slow hash (bcrypt/argon2) सुरक्षा नहीं बढ़ाते — बस एक package बढ़ाते। bcrypt passwords के लिए है, जिनमें entropy कम होती है।
- Lines 14–19: `timingSafeEqual` से constant-time comparison।
Migration में `presenter_key_hash` और `token_hash` दोनों `CHAR(64) UNIQUE` हैं (lines 23, 66)।

### 10. Presenter key leak हो जाए तो?
Mitigation: key सिर्फ़ एक बार दिखती है, URL में कभी नहीं, सिर्फ़ POST body या cookie में; logger सिर्फ़ path log
करता है; error messages में key/hash/SQL नहीं (एक अलग test फ़ाइल: `presenter-key-secrecy.test.ts`)। Key guessing
पर limit: 10 प्रयास / session / 15 मिनट, session के हिसाब से — IP बदलने से नहीं बचते (routes lines 29–35)।
**अभी नहीं है:** key rotate करने या revoke करने का तरीका। यह आगे का काम है।

### 11. एक session की cookie दूसरे session में use हो सकती है?
नहीं। Participant token को hash करके ढूँढते हैं, फिर check करते हैं कि `participant.sessionId === session.id`,
वरना 401 (`participants.service.ts` line 63; join में lines 33–35)। Edge case tests में दर्ज: session A की cookie
session B में → 401।

---

## D. Data integrity और concurrency

### 12. Race conditions कैसे संभाली? जैसे join और end एक साथ हों।
Join एक transaction में session row को `FOR SHARE` lock करता है (`participants.service.ts` lines 16–22), ACTIVE
check करता है, फिर insert। End `FOR UPDATE` lock लेता है (`api/src/services/sessions.service.ts` lines 94–100),
इसलिए चल रहे joins का इंतज़ार करता है। नतीजा: end के commit के बाद कोई join commit नहीं होता।
**असली bug जो test ने पकड़ा:** पहले `ended_at` lock से पहले तय होता था, तो वह participant के `created_at` से
पहले आ सकता था। Fix: `endedAt` lock मिलने के बाद set होता है (lines 95–104)।
**ईमानदार सीमा:** tracking में दर्ज है कि race test हर run में दोनों रास्ते hit करे, यह verify नहीं; deterministic
test बाद में।

### 13. Room code collision हो जाए तो?
Database में `room_code UNIQUE` है। `createSession` (`sessions.service.ts` lines 37–56) 5 बार तक प्रयास करता है,
हर प्रयास एक अलग INSERT, transaction के बाहर (ताकि एक failure अगले को abort न करे), और retry सिर्फ़ room code की
unique violation पर। 5 बार fail → safe 500 `ROOM_CODE_UNAVAILABLE`। Test: injected generator पहले वही code देता है;
दो concurrent creates दोनों सफल, अलग codes के साथ।

### 14. नियम code में हैं या database में?
दोनों में, पर database आख़िरी गारंटी है। Migration
`api/migrations/20261024034903-create-sessions-and-participants.cjs`:
- Lines 33–39: CHECK `(status = 'ENDED') = (ended_at IS NOT NULL)`।
- Lines 41–47: room code format का CHECK (सिर्फ़ allowed अक्षर, 6 लंबाई)।
- Lines 58–64: participants → sessions FK, `ON DELETE CASCADE`।
- Line 6: पूरी migration एक transaction में; `down` (lines 81–91) सारा data मिटाता है, इसलिए चेतावनी और approval नियम।

---

## E. Stack के फ़ैसले

### 15. Sequelize क्यों? Prisma या TypeORM क्यों नहीं?
यह project का non-negotiable stack फ़ैसला है (`CLAUDE.md`)। व्यावहारिक कारण: mature है, PostgreSQL transactions और
row locks (`transaction.LOCK.SHARE` / `LOCK.UPDATE`) सीधे देता है — हमारे race वाले हल इसी पर टिके हैं — और
`sequelize-cli` से `up`/`down` migrations। कमज़ोरी भी मानें: TypeScript typing Prisma जितनी सहज नहीं, और हर query
में `{ transaction }` देना भूलना आसान है — इसलिए यह नियम `.claude/rules/database-sequelize.md` में लिखा है।

### 16. PostgreSQL + pgvector क्यों, अलग vector DB (Pinecone, Qdrant) क्यों नहीं?
एक database, session data के साथ transactional consistency, session filter सादे SQL से, चलाने को एक चीज़ कम
(`docs/12`)। Docker image अभी से `pgvector/pgvector:pg16` है। **पर pgvector extension अभी enable नहीं किया** —
foundation decision 4 के अनुसार यह Phase 9 में होगा। बहुत बड़े scale पर retriever interface के पीछे बदल सकते हैं।

### 17. Modular monolith क्यों, microservices क्यों नहीं?
छोटा domain, एक टीम — test करना और समझाना आसान। परतें साफ़ हैं: route → validate → controller → service → model।
`shared/` में Zod schemas API और web दोनों use करते हैं। ज़रूरत पड़ी तो services और (आगे) `realtime/`, `ai/` की
सीमाओं पर तोड़ सकते हैं।

---

## F. Claude workflow

### 18. Claude workflow कैसे काम करता है?
1. `CLAUDE.md` — हर session में लोड होने वाले नियम (stack, security, "बिना चलाए pass मत कहो", किन कामों से पहले पूछना है)।
2. `.claude/rules/` — फ़ाइल के प्रकार के हिसाब से अपने-आप लगने वाले नियम (backend, database, security...)।
3. `/requirement <name>` → `requirements/<name>/requirement.md`: business भाषा में behaviours, success criteria,
   scope, risks। Sessions के लिए 13 behaviours और 10 success criteria।
4. `/execute <name>` → `planner` agent `planning-tracking.md` में plan लिखता है: decisions, contracts, files, impact,
   concurrency, edge cases।
5. **Approval gate:** मैं plan और approvals (A1 packages, A2 test DB, A3 destructive `down`) मंज़ूर करता हूँ।
6. Execution groups (G1–G9): हर task की जटिलता के हिसाब से `executor-high`, `executor-medium`, `executor-low`।
7. हर task के बाद verification, और Issues/Change log में सब दर्ज — गलतियाँ भी।

### 19. AI से बने code की गुणवत्ता कैसे check होती है?
- Plan पहले, code बाद — और plan इंसान approve करता है।
- हर task के बाद tests और typecheck; final run में lint, typecheck, unit, web, build, prettier, integration।
- Integration tests असली PostgreSQL पर — race test ने असली bug पकड़ा।
- Main session executors का काम दोबारा चलाकर देखता है (जैसे task 9: "58 of 58 pass (re-run by main session)")।
- `code-reviewer` और `security-reviewer` agents उपलब्ध हैं।
- कमज़ोर verification साफ़ लिखा जाता है: task 1 "verified (partial)" — executor ने requirement पढ़े बिना spec से
  बनाया; task 14 "NOT a real browser"।
- `CLAUDE.md` का नियम: कोई test/build pass तभी कहो जब चलाकर देखा हो।
सीमा: इंसानी code review की जगह यह नहीं लेता; मैं हर फ़ाइल समझकर own करता हूँ।

### 20. Claude ने गलती की तो पता कैसे चला? कोई उदाहरण?
तीन दर्ज उदाहरण (planning-tracking.md, Issues):
- Requirement और plan में alphabet 32 अक्षर लिखा था; असल में 0, O, 1, I, L हटाकर 31 है — code shared से पढ़ता है,
  docs ठीक किए।
- Join-vs-end race में `ended_at` का क्रम गलत था — test ने पकड़ा, fix हुआ।
- Dev database migrate नहीं था, API 500 दे रहा था — कारण मिला, `npm run db:migrate` चलाया।

### 21. इस workflow को दूसरे projects में कैसे ले जाएँ?
जो हिस्से project से स्वतंत्र हैं: `.claude/commands/` (requirement, execute, bug-fix, debug, code-review...),
`.claude/agents/` (planner, executors, reviewers), `requirements/_templates/`। Project-specific हिस्से बदलने
होंगे: `CLAUDE.md` (stack, नियम, commands), `.claude/rules/`, और skills। तरीका: पहले एक छोटे feature पर चलाएँ,
approval gate रखें, फिर टीम में फैलाएँ। पूरा विवरण `docs/claude-workflow/` में (worked example: `09-worked-example.md`)।
**सच:** अभी तक यह सिर्फ़ इसी एक project पर इस्तेमाल हुआ है।

---

## G. Tests, cost और आगे

### 22. Tests कितने हैं?
दर्ज final run (2026-10-24): **lint 0 errors · typecheck 0 errors · unit 49 pass · web 35 pass · integration 58
pass।** Integration suite असली PostgreSQL (`livepulse_test`) पर चलता है और तभी चलता है जब `NODE_ENV=test` हो,
`TEST_DATABASE_URL` set हो और database का नाम `_test` पर ख़त्म हो — dev database पर कभी नहीं। Commands: `npm test`,
`npm run test:integration -w api`। कमी: कोई end-to-end browser test नहीं; web tests `renderToStaticMarkup` से हैं।

### 23. इसमें कितना समय और पैसा लगा?
**कोई मापा हुआ आँकड़ा दर्ज नहीं है, इसलिए संख्या नहीं बताऊँगा।** Tracking में तारीख़ें हैं: sessions-and-join का
plan, approval, build और verify — सब 2026-10-24 के change log में। Token cost या घंटे record नहीं किए गए। आगे
के phases में यह मापना एक अच्छा सुधार होगा। AI features की cost control की योजना (`docs/12`): per-session token
budget, debounce, job dedupe, kill switch — पर ये अभी **नहीं बने**।

### 24. AI co-pilot कब और कैसे? Hallucination कैसे रोकोगे?
**अभी AI का कोई code नहीं है** (Phase 9+)। तय architecture (`docs/10-ai-architecture.md`, `CLAUDE.md`): Claude via
LangChain.js, multi-step flows के लिए LangGraph.js, local embeddings, pgvector, MCP server REST client के रूप में।
नियम: AI commit के बाद background job में चलेगा, सिर्फ़ draft बनाएगा, presenter approve करेगा; tests `fake`
provider से, बिना network। Hallucination के लिए योजना: retrieval session तक सीमित, citations ज़रूरी, "material में
नहीं है" वाला रास्ता, और report के numbers SQL से — LLM से नहीं। ये सब अभी योजना है, सिद्ध नहीं।

### 25. अगला कदम क्या है?
Roadmap `docs/08-implementation-plan.md` के अनुसार:
1. पहले बचे हुए काम: असली browser में cookie flow जाँचना, `docs/04` की error-code list पूरी करना, ESLint में Next
   plugin, npm advisories।
2. Realtime backbone: Socket.IO + Redis adapter, live count, reconnect पर snapshot।
3. Polls/word cloud/Q&A/reactions: `(poll_id, participant_id)` unique + row lock, duplicate vote पर 409।
4. फिर AI co-pilot और MCP।
हर नया phase सिर्फ़ explicit approval के बाद शुरू होगा (`CLAUDE.md`)।
