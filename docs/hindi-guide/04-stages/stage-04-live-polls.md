# Stage 04 — Live Polls (live मतदान)

> स्रोत (source): `requirements/live-polls/requirement.md`, `requirements/live-polls/planning-tracking.md`, और असली
> code (`api/src/services/polls.service.ts`, `api/src/services/votes.service.ts`, `api/src/services/sessions.service.ts`
> का `endSession`, `api/src/realtime/polls.ts`, `api/src/controllers/polls.controller.ts`,
> `api/src/routes/polls.routes.ts`, `api/migrations/20261024060103-create-polls-and-votes.cjs`,
> `shared/src/schemas/polls.ts`, `web/src/components/polls/`, `web/src/hooks/`, `web/src/lib/api/polls.ts`) और
> `api/tests/integration/` व `api/tests/realtime/` के poll tests। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं
> हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Presenter session के दौरान 2–6 विकल्पों वाले polls बनाता है, एक समय में एक poll खोलता (start) और बंद (close) करता
है; हर participant हर poll में **एक ही** vote देता है; presenter को counts और percentages live दिखते हैं, और
participants को तभी जब presenter उस poll के लिए results दिखाने का switch चालू रखे। Closed poll सिर्फ़ पढ़ने के लिए
(read-only) है। यह roadmap का **Phase 5** है (`docs/08-implementation-plan.md`)।

### Git की स्थिति (commit)

सबसे नया commit अब भी `1f6937f foundation and session and join work` है। Stage 3 (realtime-backbone) और यह stage —
दोनों का code **अभी commit नहीं हुआ है**। Commit आप करेंगे।

---

## 2. Requirement का सार — व्यापार की भाषा में

File: `requirements/live-polls/requirement.md` — Status `completed` (line 5)।

### कौन इस्तेमाल करता है
- **Presenter** — polls बनाता है, start/close करता है, तय करता है कि participants results देखें या नहीं, counts पढ़ता है।
- **Participant** — खुले poll में एक बार vote देता है; अनुमति हो तो results देखता है।

### Key behaviours (मुख्य व्यवहार) 1–13

| # | व्यवहार (हिंदी में) | Notes |
|---|---|---|
| 1 | Presenter question और 2–6 options वाला poll बनाता है | Question 200 अक्षर तक, option 80 तक; options ख़ाली नहीं और अलग-अलग |
| 2 | नया poll draft (मसौदा) होता है, participants को नहीं दिखता | बनने के बाद question/options बदलते नहीं |
| 3 | Session में एक समय में सिर्फ़ एक poll खुला | दूसरा start साफ़ संदेश के साथ ठुकराया जाता है |
| 4 | Start करते ही हर जुड़े participant को poll दिखता है | बाद में join करने वाले को आते ही खुला poll दिखता है |
| 5 | हर participant हर poll में एक vote | पहला vote अंतिम; दोहराए या एक साथ भेजे votes दूसरा vote नहीं बनाते |
| 6 | Vote तभी दर्ज जब poll खुला और session active हो | वरना साफ़ संदेश के साथ refuse |
| 7 | हर vote के बाद presenter के counts और percentages live बदलते हैं | Percentages के साथ counts भी |
| 8 | Participants को live results सिर्फ़ तब जब presenter ने उस poll के लिए दिखाना चुना | फ़ैसला server का; छुपे results participants को कभी नहीं भेजे जाते |
| 9 | Close करते ही सारे votes रुकते हैं | Close के साथ आया vote — एक ही साफ़ नतीजा |
| 10 | Closed poll read-only: न vote, न edit, न restart | Results दिखाने की अनुमति हो तो final result दिखता रहता है |
| 11 | Reload करने पर participant को अपना चुना option दिखता है | दोबारा vote नहीं कर सकता |
| 12 | Votes कभी दो बार नहीं गिने जाते | Retry किए requests count नहीं बढ़ाते |
| 13 | Session ख़त्म होने के बाद न start न vote | Session end खुले poll को बंद करता है |

### Scope
- **In:** poll बनाना (draft) + per-poll results switch; start, close, results दिखाना/छुपाना; एक vote प्रति poll;
  presenter के लिए live counts; अनुमति पर participants के लिए live results; reconnect/reload पर recovery; एक समय
  में एक खुला poll।
- **Out:** एक साथ कई खुले polls, poll edit, vote बदलना, multiple-choice answers, quiz/score, export और charts,
  voter-wise reports।

### Success criteria (सफलता की कसौटी) 1–11
1. 2–6 options वाला poll बनता है; 1 या 7 options साफ़ संदेश से refuse।
2. Start करने पर जुड़े participant को बिना refresh poll दिखता है।
3. एक खुला हो तो दूसरा poll start नहीं होता।
4. एक participant का double tap या दो tabs = ठीक एक vote।
5. दो अलग participants एक साथ vote करें तो दोनों गिने जाते हैं।
6. Results छुपे हों तो participant की screen और हर participant message में कोई count नहीं।
7. Results दिखते हों तो participant को counts live बदलते दिखते हैं।
8. Close के बाद आया vote refuse; close के साथ आया vote एक साफ़ नतीजा देता है (concurrency test से जाँचा)।
9. Close के बाद कोई vote नहीं, और presenter को final result दिखता रहता है।
10. Vote के बाद reload करने वाले participant को अपना choice दिखता है, दोबारा vote नहीं।
11. Session end खुले poll को बंद करता है और बाद के polls refuse करता है।

---

## 3. स्पष्टीकरण (clarification) के सवाल और जवाब

Requirement का change log (line 145): *"Created and confirmed (one open poll; per-poll result switch, default on;
votes final; 200/80 character limits)"*।

| # | सवाल | जवाब (developer ने चुना) |
|---|---|---|
| — | एक समय में कितने खुले polls? | **एक** open poll प्रति session |
| — | Results दिखाने का फ़ैसला कैसे? | **हर poll का अपना switch**, default on |
| — | Vote बदल सकते हैं? | नहीं, **votes final** |
| — | Text की सीमा? | Question 200 अक्षर, option 80 अक्षर, 2–6 options |
| Q1 | Close के बाद results switch बदल सकते हैं? | **हाँ** (बाद में reveal); poll का content fixed रहता है |
| Q2 | Mid-poll छुपाने पर कुछ milliseconds की race? | **स्वीकार**, पर test के साथ |
| Q3 | Duplicate vote पर क्या लौटे? | **409 `VOTE_ALREADY_RECORDED`** |
| Q4 | Vote rate limit? | **300 प्रति minute प्रति IP** |

### Defaults जो बिना पूछे लिए गए (planning-tracking "Decisions")
- **50 polls प्रति session** (उससे ऊपर `409 POLL_LIMIT_REACHED`)।
- कोई poll खुला न हो तो participant को **आख़िरी closed poll** दिखता है।

### Approvals
- Plan v1 developer ने 2026-10-24 को approve किया।
- नए packages: कोई नहीं।
- Destructive `down` migration: असली data वाले database पर चलाने से पहले approval ज़रूरी (अभी सिर्फ़ test DB पर)।

---

## 4. Plan v1 का सार

### Architecture (ढाँचा)
- **DB:** तीन नई tables `polls`, `poll_options`, `votes` — एक additive (सिर्फ़ जोड़ने वाली) migration।
- **API:** `POST/GET /api/sessions/:id/polls`, `POST /api/polls/:id/start`, `POST /api/polls/:id/close`,
  `PATCH /api/polls/:id` (`{ showResults }`), `POST /api/polls/:id/votes`,
  `GET /api/sessions/by-code/:code/polls/current` (participant)।
- **Realtime:** `poll:started`, `poll:closed`, `poll:updated` → session room; `poll:results` → छुपा हो तो presenter
  room, दिखता हो तो session room। सब commit के **बाद** `api/src/realtime/polls.ts` से।
- **Web:** presenter page → `PollsPanel`; participant page → `ParticipantPoll`; `useSessionSocket` में poll events जुड़े।

### DB की invariants (नियम जो database ख़ुद लागू करता है)
1. **Partial unique index `polls_one_active_per_session`** — `ON polls(session_id) WHERE status = 'ACTIVE'`। एक session
   में दूसरा ACTIVE poll commit ही नहीं हो सकता। Service इस unique violation को `409 POLL_ALREADY_ACTIVE` ("Close the
   open poll first.") में बदलती है; code का pre-check सिर्फ़ अच्छा संदेश देता है।
2. **Unique `(poll_id, participant_id)`** (`votes_poll_participant_key`) — एक participant का एक poll में एक vote।
   `castVote` इस constraint के `UniqueConstraintError` को `409 VOTE_ALREADY_RECORDED` में बदलता है।
3. **Composite FK `(option_id, poll_id) → poll_options(id, poll_id)`** (`votes_option_poll_fkey`, raw SQL क्योंकि
   `queryInterface` composite FK नहीं बना सकता) — vote का option उसी poll का होना ज़रूरी। इसके लिए `poll_options` पर
   unique `(id, poll_id)` रखा गया।
4. बाक़ी: CHECK `(status = 'CLOSED') = (closed_at IS NOT NULL)`, question/label ख़ाली नहीं, `position` 0–5, unique
   `(poll_id, position)` और `(poll_id, label)`; FKs पर CASCADE।

### Lock order (ताला लगाने का क्रम)
- नियम: **हमेशा session पहले, फिर poll**। कोई transaction poll के बाद session lock नहीं करता (deadlock से बचाव)।
- **Vote:** poll `FOR SHARE` (session lock नहीं)। इसलिए एक साथ आए votes एक-दूसरे को नहीं रोकते।
- **Start:** session `FOR SHARE` → poll `FOR UPDATE`। **Close** और **show-results switch:** poll `FOR UPDATE`।
  `FOR UPDATE` पहले से चल रहे votes (`FOR SHARE`) के commit होने का इंतज़ार करता है; बाद के votes CLOSED देखते हैं।
- **Create:** session `FOR SHARE`, ताकि end इसके commit तक रुके।
- **End:** session `FOR UPDATE`, फिर उसी transaction में खुला poll CLOSED — session और poll साथ ख़त्म होते हैं या
  बिल्कुल नहीं।
- Plan ने नोट किया: docs/02 में votes के लिए `FOR UPDATE` लिखा था; उसे `FOR SHARE` में अपडेट किया गया।

### मुख्य फ़ैसले और कारण
1. **Votes HTTP पर, socket command नहीं** — cookie auth, rate limits और error envelope पहले से HTTP पर हैं; वही दोबारा
   इस्तेमाल।
2. **`version` = कुल votes।** Votes final हैं, इसलिए यह सिर्फ़ बढ़ता है; client कोई भी update जो नया नहीं, छोड़ देता है
   (`web/src/hooks/poll-merge.ts`: बड़ा version जीतता है)।
3. **Combined broadcasts, fresh reads।** Vote-count updates हर poll के लिए ~250 ms (`RESULTS_COMBINE_MS`) में इकट्ठे
   होते हैं, और भेजते समय counts और `show_results` database से **ताज़ा** पढ़े जाते हैं।
4. **कौन सा room कौन सा result पाता है:** fresh read में `showResults` false → सिर्फ़ `presenter:<id>`; true →
   `session:<id>` (presenter भी उसमें है, इसलिए एक ही room)। Session id poll row से आता है, caller से नहीं।
5. Clients `poll:started`, `poll:closed`, `poll:updated` पर और हर connect पर HTTP से refetch करते हैं; सिर्फ़
   `poll:results` सीधे लागू होता है।
6. Closed poll को दोबारा close = 200 बिना बदलाव (retry सुरक्षित)।
7. docs/04 का `GET /polls/:id/results` हटाकर presenter list और participant current-poll endpoint।

### Per-recipient नियम
`ParticipantPoll` में `results` तब हमेशा `null` जब `showResults` false हो — यह फ़ैसला **एक ही** participant mapper
करता है। Drafts participants के लिए 404। किसी payload में voter की पहचान नहीं।

### Contracts (socket events, server → client)

| Event | Room | Payload |
|---|---|---|
| `poll:started` | session | `{ poll: { id, question, options, showResults } }` (counts नहीं) |
| `poll:closed` | session | `{ pollId, closedAt }` (session end से बंद होने पर भी) |
| `poll:updated` | session | `{ pollId, showResults }` (clients refetch करते हैं) |
| `poll:results` | छुपा: presenter; दिखता: session | `{ pollId, total, version, options }` |

### Impact analysis
- **Breaking:** `endSession` अब `{ session, closedPoll }` लौटाता है; `initModels` में तीन models; `AppRealtime` में
  poll emitters (test fakes)। Events additive।
- **Migration:** एक additive migration; `down` destructive (poll और vote data मिटाता है), file में WARNING comment।
- **Security:** ownership — हर `/polls/:id` route poll load करता है, `sessionId` उसी row से लेता है और उस session की
  cookie जाँचता है। Zod हर body पर; create (60/min) और vote (300/min) पर rate limits।

---

## 5. Tasks (v1) — tracking table की असली स्थिति

सभी 14 tasks `planning-tracking.md` में `verified` दर्ज हैं।

| # | Task | Complexity | Executor | Status | Notes (tracking से) |
|---|---|---|---|---|---|
| 1 | Shared poll schemas और DTO types | MEDIUM | executor-medium | verified | shared 59 tests (13 poll schema, 3 event) |
| 2 | Shared poll event schemas और event map | LOW | executor-low | verified | poll event schemas |
| 3 | Migration (generated), constraints, partial index | HIGH | executor-high | verified | test DB पर up/down/up; 4 constraint probes ने अपेक्षित errors दिए |
| 4 | Models, associations, `Models` type, truncate helper | MEDIUM | executor-medium | verified | 5 poll model tests |
| 5 | `polls.service`: create, list, current, start, close, switch, results, mappers | HIGH | executor-high | verified | 10 polls-service tests; lock order session फिर poll |
| 6 | `votes.service` `castVote` | HIGH | executor-high | verified | concurrency 5 tests (duplicate, दो tabs, दो voters, vote बनाम close) |
| 7 | `endSession` खुला poll बंद करे | HIGH | executor-high | verified | lock wait के बाद `closed_at` = `clock_timestamp()`; 5 end tests |
| 8 | Realtime poll emitters, combined counts, shutdown cleanup, test stubs | HIGH | executor-high | verified | fresh reads; 7 realtime tests |
| 9 | Controller, routes, limiters, commit के बाद emit, end पर `poll:closed` | MEDIUM | executor-medium | verified | 16 route tests; voter poll के session का होना चाहिए; limiters 60 create / 300 vote |
| 10 | Cross-cutting secrecy और two-starts tests | HIGH | executor-high | verified | छुपे results participants तक नहीं; races 5 बार clean |
| 11 | Web API client, socket reducer और hook additions, poll hooks | MEDIUM | executor-medium | verified | merge rule; कुल 88 web tests |
| 12 | Presenter `PollsPanel`, create form, results (counts और %, `aria-live="polite"`) | MEDIUM | executor-medium | verified | build ok; browser में नहीं देखा |
| 13 | Participant poll view (बड़े buttons, recorded, closed, hidden states) | MEDIUM | executor-medium | verified | reload पर चुना option; browser में नहीं देखा |
| 14 | Docs 02, 03, 04, 05 और tracking | LOW | executor-low | verified | docs 02–05 अपडेट (English) |

---

## 6. Execution groups और मुख्य पल

| Group | Tasks | Executor |
|---|---|---|
| G1 | 1, 2 | executor-medium, फिर executor-low |
| G2 | 3 | executor-high |
| G3 | 4 | executor-medium |
| G4 | 5, 6, 7 | executor-high |
| G5 | 8 | executor-high |
| G6 | 9 | executor-medium |
| G7 | 10 | executor-high |
| G8 | 11, 12, 13 | executor-medium |
| G9 | 14 | executor-low |

### 1. Migration: up / down / up और constraint probes (G2)
Migration `api/migrations/20261024060103-create-polls-and-votes.cjs` पूरा एक transaction में चलता है। Enum
`enum_polls_status` पहले अलग से बनता है; `down` उल्टे क्रम में `votes` → `poll_options` → `polls` drop करके enum हटाता
है। Test DB पर up → down → up चलाया गया, और 4 constraint probes (जानबूझकर ग़लत inserts) ने अपेक्षित errors दिए
(tracking task 3)। `poll-models.test.ts` यही नियम दोहराता है: दूसरा active poll refuse, दूसरे poll का option refuse,
दूसरा vote refuse, session delete पर cascade।

### 2. Held-lock race tests (G4, G7)
Race tests असली Postgres पर एक transaction में poll को `FOR UPDATE` पकड़कर रखते हैं, फिर vote भेजते हैं: vote इंतज़ार
करता है और close commit होने पर `POLL_NOT_ACTIVE` से refuse होता है; उल्टे क्रम में पहले से चल रहा vote close से
पहले पूरा होता है (`votes-concurrency.test.ts` — "a vote that waits behind a close is refused…", "a vote already in
flight finishes before a close takes effect")। Route स्तर पर `polls-races.test.ts`: दो अलग drafts के दो एक साथ starts
→ ठीक एक active poll; close बनाम vote → एक ही साफ़ नतीजा; vote के बीच session end → vote गिना जाता है और poll एक बार
बंद होता है।

### 3. End खुला poll बंद करता है — `clock_timestamp()` का fix (G4)
`endSession` (`sessions.service.ts` line 92–121) session को `FOR UPDATE` lock करता है, फिर एक raw `UPDATE polls …
WHERE status = 'ACTIVE' RETURNING id, closed_at` चलाता है। पहले `closed_at` lock wait से **पहले** तय हो जाता था, तो
wait के दौरान commit हुआ vote close time से बाद का दिख सकता था। हल: `closed_at = clock_timestamp()` — यह हर row update
होते समय पढ़ा जाता है, यानी votes (`FOR SHARE`) के इंतज़ार के **बाद**। (`now()` पूरे transaction का शुरुआती समय देता,
इसलिए वह काम नहीं करता।) अब wait में commit हुआ vote कभी `closed_at` से बाद का नहीं होता।

### 4. Vote-membership check route में (G6)
`castVote` session नहीं जाँचता (`votes.service.ts` line 13 का comment)। Controller का `voteAuth` पहले poll load करता
है, participant cookie पढ़ता है और `participant?.sessionId !== sessionId` पर `401 PARTICIPANT_AUTH_REQUIRED` देता है
(`polls.controller.ts` line 110–116)। Route में `voteAuth` body validation से **पहले** चलता है
(`polls.routes.ts` line 56–64)। नतीजा: session end के बाद vote को `POLL_NOT_ACTIVE` मिलता है, `SESSION_ENDED` नहीं।

### 5. Realtime emitters और combined updates (G5, G6)
`createPollEmitters` (`realtime/polls.ts`): per-poll timer map; `scheduleResults` 250 ms में burst को एक update बनाता
है; `emitResultsNow` pending timer रद्द करके तुरंत भेजता है; `clearPollTimers` shutdown पर सब रोकता है। कोई emitter
throw नहीं करता। Controller का क्रम: close पर पहले final counts (`emitResultsNow`), फिर `poll:closed`; switch बदलने पर
`poll:updated` फिर counts — सिर्फ़ जब value सच में बदली हो।

### 6. Dev DB migration failure (issue, सुलझा)
Live जाँच में poll बनाने पर **500 `relation "polls" does not exist`** आया — dev database पर forward migration चला ही
नहीं था। Forward migration dev DB पर चलाने के बाद ठीक हुआ। (सिर्फ़ `up`; कोई reset या `down` नहीं।)

### Web की बातें (code से)
- `PollResults.tsx`: `aria-live="polite"`, counts के साथ %, bars पर `motion-reduce:transition-none`।
- `poll-messages.ts`: `POLL_NOT_ACTIVE` → "This poll is closed."; participant vote के बाद "Your vote is recorded."
- `use-presenter-polls.ts` / `use-participant-poll.ts`: HTTP snapshot + live `poll:results` का merge, version से।

---

## 7. Verification — इस run में असल में क्या चला

| Check | नतीजा |
|---|---|
| lint | 0 |
| typecheck | 0 |
| unit tests | shared 59 + api 52 + web 88 pass |
| web build | 0 (सफल) |
| prettier | 0 |
| integration (असली Postgres + असली Redis) | **172/172 pass, 30 files** |
| live end-to-end | **22/22 checks pass** |

(ये नंबर इस stage के final run से हैं; यह document लिखते समय commands दोबारा नहीं चलाए गए।)

### Live end-to-end (22 checks, असली run)
यह run मैंने dev servers (API पोर्ट 4000, web पोर्ट 3000) पर चलाया। HTTP और असली socket clients (presenter + दो participants) दोनों इस्तेमाल हुए। एक temporary Node script ने checks चलाए और run के बाद उसे हटा दिया गया। नतीजे उसी output से लिए गए हैं:

| # | Check | नतीजा |
|---|---|---|
| 1 | create session | PASS |
| 2 | create draft poll (results hidden) | PASS (201) |
| 3 | two participants join | PASS |
| 4 | presenter और दो participants live connected | PASS |
| 5 | start poll (200) | PASS |
| 6 | participants को `poll:started` बिना counts के | PASS |
| 7 | दूसरा poll रोका गया जब एक खुला है (409) | PASS |
| 8 | दो votes recorded (201/201) | PASS |
| 9 | duplicate vote refused (409) | PASS |
| 10 | hidden: participant current-poll में `results` null | PASS |
| 11 | hidden: किसी participant तक `poll:results` नहीं पहुँचा | PASS |
| 12 | hidden: presenter को live counts मिले (total 2) | PASS |
| 13 | reveal results (PATCH 200) | PASS |
| 14 | shown: participants को live `poll:results` मिले (total 2) | PASS |
| 15 | close poll (200) | PASS |
| 16 | participants को `poll:closed` मिला | PASS |
| 17 | close के बाद vote refused (409) | PASS |
| 18 | closed poll पर presenter को final counts (total 2) | PASS |
| 19 | participant messages में कोई secret या cookie value नहीं | PASS |
| 20 | end session (200) | PASS |
| 21 | participants को `session:ended` मिला | PASS |
| 22 | end के बाद join refused (404) | PASS |

**नतीजा: 22 में से 22 PASS।**

### Tests — कौन सी file क्या साबित करती है

| File | Tests | क्या साबित करता है |
|---|---|---|
| `integration/poll-models.test.ts` | 5 | Default switch; दूसरा active poll, दूसरे poll का option, दूसरा vote — DB refuse करता है; cascade delete |
| `integration/polls-service.test.ts` | 10 | Create क्रम, ended session, 51वाँ poll, start दो बार, दूसरा खुला poll, close idempotent, close के बाद switch, hidden mapper, 0%, अपना choice |
| `integration/votes-service.test.ts` | 6 | एक vote, closed refuse, draft 404, दूसरे poll का option 400, duplicate 409, reload पर choice |
| `integration/votes-concurrency.test.ts` | 5 | Identical votes = 1; दो tabs = 1; दो participants = 2; close के पीछे इंतज़ार करता vote refuse; चल रहा vote close से पहले पूरा |
| `integration/end-closes-poll.test.ts` | 5 | End खुला poll बंद करके लौटाता है; बिना poll `null`; दो बार end = कोई बदलाव नहीं; चलता vote गिना जाता है; end के बाद vote refuse |
| `integration/polls-routes.test.ts` | 16 | 201 create, cross-session cookie, 404/403 origin, 409s, duplicate vote, दूसरे session का voter 401, draft 404, `INVALID_OPTION`, close क्रम, switch सिर्फ़ बदलने पर emit, malformed body echo नहीं, rate limit, end पर `poll:closed` |
| `integration/polls-races.test.ts` | 3 | दो starts → एक active; close बनाम vote → एक नतीजा; end बनाम vote → vote गिना, poll एक बार बंद |
| `realtime/poll-live.test.ts` | 7 | Start बिना counts; close सबको; hidden counts सिर्फ़ presenter; shown counts सबको; burst = एक combined update; दूसरा session कुछ नहीं पाता; failed emit throw नहीं |
| `realtime/poll-secrecy.test.ts` | 5 | Hidden में participants को counts नहीं; current-poll और vote response में भी नहीं; reveal पर counts; फिर hide करने के commit के बाद counts नहीं; किसी message में voter identity/token/cookie/hash नहीं |

---

## 8. नहीं जाँचा गया (NOT VERIFIED)

1. **असली browser में UI का रूप** — layout, contrast, motion; components सिर्फ़ unit tests और build से जाँचे।
2. **असली browser में live updates** — start, counts, reveal, close दो असली browsers में नहीं देखे।
3. **एक शुरुआती race-test failure** — output खो गया; बाद के 5 runs और पूरा suite pass; दोबारा नहीं हुआ (कारण अज्ञात)।
4. **50 polls का default** — बिना पूछे लिया गया; product की ज़रूरत से मिलान नहीं हुआ। Code comment के अनुसार 49 पर दो
   एक साथ creates दोनों पास हो सकते हैं (soft limit)।
5. **Production में 300/min vote limit** — असली load या NAT के पीछे कई लोगों वाले IP पर नहीं मापा।

---

## 9. Issues और जोखिम

`planning-tracking.md` के "Issues & updates" से:

- **2026-10-24 · HIGH (सुलझा) — Dev DB में poll tables नहीं:** poll बनाना 500 (`relation "polls" does not exist`)
  देता रहा, जब तक forward migration dev DB पर नहीं चला।
- **2026-10-24 · MEDIUM (सुलझा) — Close time का क्रम:** vote के बीच session end होने पर `closed_at` wait से पहले तय
  होता था, तो vote close time से बाद का हो सकता था। हल: lock wait के बाद `clock_timestamp()`।
- **2026-10-24 · LOW (खुला) — अस्पष्ट race failure:** race file का एक शुरुआती run fail हुआ, output खो गया। बाद के पाँच
  runs और पूरा suite pass। दोबारा नहीं हुआ।
- **2026-10-24 · LOW (ज्ञात) — vote service में session check नहीं:** `castVote` session नहीं जाँचता, route जाँचता है।
  End के बाद vote पर `POLL_NOT_ACTIVE` मिलता है, `SESSION_ENDED` नहीं।
- **2026-10-24 · NOT VERIFIED:** poll UI असली browser में कैसा दिखता और चलता है; असली browser में live polls।

Plan से अतिरिक्त जोखिम:
- **RISK (स्वीकार, Q2) — hide race:** mid-poll results छुपाते समय कुछ milliseconds में एक count update participants तक
  जा सकता है; test commit के बाद का व्यवहार जाँचता है।
- **RISK — destructive `down`:** migration का `down` सारा poll और vote data मिटाता है; असली data पर approval ज़रूरी।

---

## 10. अगले कदम

1. Commit — **आप** करेंगे (Claude नहीं); Stage 3 और Stage 4 दोनों का code अभी uncommitted है।
2. दो असली browsers में poll UI और live updates हाथ से देखना (flows 1–3)।
3. Stage 5 पर फ़ैसला — अभी **तय नहीं** (undecided)। Roadmap में अगला `word-cloud` (Phase 6) है; short demo path में
   Phase 5 के बाद Phase 7 (`live-qna`) आता है। आपकी स्पष्ट approval के बिना शुरू नहीं होगा।
