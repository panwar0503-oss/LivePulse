# Stage 06 — Live Q&A (सवाल-जवाब)

> स्रोत (source): `requirements/live-qna/requirement.md`, `requirements/live-qna/planning-tracking.md`, और असली code
> (`shared/src/schemas/qna.ts`, `api/src/services/questions.service.ts`,
> `api/src/services/question-upvotes.service.ts`, `api/src/services/sessions.service.ts` के `setQnaOpen` और
> `endSession`, `api/src/realtime/questions.ts`, `api/src/controllers/questions.controller.ts`,
> `api/src/routes/questions.routes.ts`, `api/migrations/20261024120203-add-qna-open-to-sessions.cjs`,
> `api/migrations/20261024120206-create-questions-and-upvotes.cjs`, `web/src/components/qna/`,
> `web/src/hooks/use-presenter-questions.ts`, `use-participant-questions.ts`, `questions-merge.ts`) और
> `api/tests/integration/` व `api/tests/realtime/` के Q&A tests। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं
> हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Session के दौरान audience सवाल टाइप करती है; हर सवाल तुरंत सबकी screen पर आता है; लोग उन सवालों को **upvote**
(समर्थन का एक वोट) देते हैं जिनका जवाब वे चाहते हैं, और सबसे ज़्यादा upvotes वाले सवाल ऊपर आते हैं। Presenter किसी
सवाल को **pin** (सबसे ऊपर टाँकना) कर सकता है, अनुचित सवाल **hide** (छुपाना) कर सकता है, सवाल को answered मार्क
करके छोटा जवाब लिख सकता है, और पूरे session का Q&A **pause/resume** (रोकना/फिर खोलना) कर सकता है। यह roadmap का
**Phase 7** है (`docs/08-implementation-plan.md`)।

### Git की स्थिति (commit)

सबसे नया commit `f490373 added poll and worldcloud requirements` है। इस stage का code **अभी commit नहीं हुआ है** —
नई files git status में untracked (`??`) और बदली files modified (`M`) दिखती हैं। Commit आप करेंगे।

---

## 2. Requirement का सार — व्यापार की भाषा में

File: `requirements/live-qna/requirement.md` — Status `completed` (line 5)।

### कौन इस्तेमाल करता है
- **Presenter** — Q&A खोलता और बंद करता है; सवाल pin, hide और restore करता है; answered मार्क करता है; छोटे जवाब
  लिखता है।
- **Participant** — सवाल पूछता है, दूसरों के सवालों को upvote करता है, presenter के जवाब देखता है।

### Key behaviours (मुख्य व्यवहार) 1–12

| # | व्यवहार (हिंदी में) | Notes |
|---|---|---|
| 1 | Participant सवाल भेजता है | Trim; 1–200 अक्षर; control characters नहीं; ख़ाली refuse, साफ़ संदेश के साथ |
| 2 | हर participant एक session में 5 सवाल तक | छठा refuse |
| 3 | सवाल सबको तुरंत दिखते हैं | Hidden सवाल participants को कभी नहीं दिखते |
| 4 | एक participant एक सवाल को एक बार upvote करता है | दोहराया upvote कुछ नहीं करता; अपने सवाल को upvote नहीं |
| 5 | क्रम: upvotes (ज़्यादा पहले), फिर पुराना पहले | हर screen पर एक ही क्रम |
| 6 | Presenter सवाल pin करता है | Pinned सवाल upvotes से ऊपर रहता है |
| 7 | Presenter hide और बाद में restore करता है | Hidden सवाल participants की screen से तुरंत हटता है |
| 8 | Presenter answered मार्क करता है और छोटा जवाब (500 अक्षर तक) लिखता है | जवाब सबको सवाल के नीचे plain text में |
| 9 | Presenter पूरे session का Q&A open/close करता है | Closed में नए सवाल और upvotes refuse; पुराने सवाल दिखते रहते हैं |
| 10 | Text हमेशा plain text | Markup जैसा टाइप हुआ वैसा दिखता है, कभी चलता (run) नहीं |
| 11 | Session end Q&A बंद करता है | End के बाद कोई सवाल या upvote नहीं |
| 12 | दोहराई या एक साथ आई requests दूसरा upvote या सवाल की दूसरी copy नहीं बनातीं | Retry सुरक्षित |

### Scope
- **In:** सवाल भेजना (5 प्रति participant प्रति session), हर सवाल पर एक upvote, live क्रमबद्ध सूची; presenter के
  pin, hide, restore, answered, छोटा जवाब (500 अक्षर), Q&A open/close; plain-text display; reconnect/reload पर
  recovery।
- **Out:** AI moderation (बाद का AI feature), दिखाने से पहले approval (सवाल तुरंत दिखते हैं — यह जानबूझकर चुना),
  threaded replies, author का सवाल edit/delete करना, participants की नाम से पहचान।

### Success criteria (सफलता की कसौटी) 1–11
1. Participant सवाल भेजे; session में सबको बिना refresh दिखे।
2. एक participant का छठा सवाल साफ़ संदेश से refuse।
3. एक ही सवाल पर एक participant का दो बार, या दो tabs से upvote = ठीक एक upvote।
4. Participant अपने सवाल को upvote नहीं कर सकता।
5. क्रम upvotes फिर उम्र से; pinned सवाल सबसे ऊपर।
6. Hidden सवाल किसी participant response या message में नहीं; restore करने पर upvotes के साथ वापस।
7. Presenter का छोटा जवाब सबको सवाल के नीचे plain text में।
8. Q&A closed हो तो नए सवाल और upvotes साफ़ संदेश से refuse; reopen करने पर फिर चालू।
9. Markup वाला सवाल या जवाब literal text दिखता है।
10. Session end Q&A बंद करता है और बाद के सवाल/upvotes refuse करता है।
11. Presenter key और participants की पहचान किसी participant message में नहीं।

---

## 3. स्पष्टीकरण (clarification) के सवाल और जवाब

Requirement का change log (line 134): *"Created and confirmed (questions visible immediately; Q&A open/close switch;
500-character answers; 5 questions and one upvote per question per participant)"*।

| # | सवाल | जवाब (developer ने चुना) |
|---|---|---|
| — | सवाल कब दिखें — तुरंत, या presenter की approval के बाद? | **तुरंत सबको**; presenter hide करके moderate करता है |
| — | Q&A रोकने का तरीक़ा? | **पूरे session के लिए एक open/closed switch** |
| — | जवाब कितना लंबा? | **500 अक्षर**, plain text, एक सवाल का एक जवाब (नया जवाब पुराने को बदल देता है) |
| — | सीमाएँ? | **5 सवाल** प्रति participant प्रति session; हर सवाल पर **एक upvote** प्रति participant |
| Q1 | वही text दोबारा भेजे तो? | **Refuse** — 409 `QUESTION_ALREADY_ASKED` (unique key से) |
| Q2 | Q&A default में खुला या बंद? | **खुला** (column default `true`) |
| Q3 | दूसरा pin? | **Pin पुराने pin को बदल देता है** (एक समय में एक pinned सवाल) |
| Q5 | जवाब में कई lines? | **एक लाइन** — सवाल वाला नियम (trim, 1–500 अक्षर, control characters नहीं) |
| — | Rate limits? | **Submit 120/min प्रति IP, upvote 300/min प्रति IP** |

(Tracking में Q4 का कोई नंबर दर्ज नहीं है — पुष्टि नहीं हुई।)

### Defaults जो बिना पूछे लिए गए
- **Session end के बाद moderation (hide, answer) की अनुमति** (Key decision 7)।
- 5-सवाल की सीमा ही असली सीमा है; rate limits सिर्फ़ spam रोकने के लिए (Key decision 8)।

### Approvals
- Plan v1 developer ने 2026-10-24 को approve किया।
- नए packages: कोई नहीं।
- Session column: `sessions.qna_open` (additive ALTER)।
- Destructive `down`: `create-questions-and-upvotes` सारा Q&A data मिटाता है — approval तक सिर्फ़ test DB।

---

## 4. Text के नियम

Code: `shared/src/schemas/qna.ts`।

- **`questionTextSchema`:** trim → 1–200 अक्षर → control characters (`\u0000-\u001f`, `\u007f`) नहीं। संदेश:
  "Type a question." / "Use 200 characters or fewer." / "Use plain text without special characters."
- **`answerTextSchema`:** trim → 1–500 अक्षर → line break नहीं ("Keep the answer to one line.") → control
  characters नहीं।
- **`questionTextKey(text)`** — duplicate पकड़ने की key: whitespace एक space, NFC, lowercase (word cloud जैसा;
  accents रखे जाते हैं)। इसलिए `"What is RAG?"` और `"what  is rag?"` एक ही participant से दूसरी बार = 409।
- **`patchQuestionBodySchema`:** `{ hidden?, pinned?, answered?, answerText? }`; कम से कम एक field ज़रूरी
  ("Change at least one field.")। `answerText: null` जवाब हटाता है।
- **`updateQnaSettingsBodySchema`:** `{ qnaOpen: boolean }`, `strict` (कोई अतिरिक्त field नहीं)।

---

## 5. Plan v1 का सार

### Architecture (ढाँचा)
- **DB:** `sessions.qna_open` (नया column) · `questions` · `question_upvotes` — दो migrations। Upvote की गिनती
  `question_upvotes` से **गिनी (count) जाती है**, कहीं store नहीं होती।
- **API:** `POST/GET /api/sessions/by-code/:code/questions` (participant), `GET /api/sessions/:id/questions`
  (presenter, hidden सहित), `POST /api/questions/:id/upvotes`, `PATCH /api/questions/:id`,
  `PATCH /api/sessions/:id/settings` (`{ qnaOpen }`)।
- **Realtime:** `question:created`, `question:updated`, `qna:status`, `question:upvotes` → session room। सब commit के
  **बाद**।
- **Web:** presenter page → `QnaPanel` (`PresenterQna`); `ParticipantClient` → `LiveParticipantQna`।

### DB की invariants (नियम जो database ख़ुद लागू करता है)
1. **`sessions.qna_open`** — `BOOLEAN NOT NULL DEFAULT true`; migration में ended sessions पर backfill `false`; CHECK
   `sessions_qna_closed_when_ended`: `status = 'ACTIVE' OR qna_open = false` — ended session में Q&A कभी खुला नहीं।
2. **Partial unique index `questions_one_pinned_per_session`** — `ON questions (session_id) WHERE pinned`। एक
   session में दो pinned सवाल commit ही नहीं हो सकते।
3. **Unique `questions_participant_text_key`** — `(participant_id, text_key)`; एक participant वही सवाल दोबारा नहीं।
4. **Unique `question_upvotes_question_participant_key`** — `(question_id, participant_id)`; एक सवाल पर एक upvote।
5. बाक़ी: CHECK text ख़ाली नहीं; answer null या ख़ाली नहीं; CHECK `NOT (pinned AND hidden)`; FKs पर CASCADE;
   index `(session_id, created_at)`।

Answered = `answered_at` not null। `answer_text` अलग column है, इसलिए नया जवाब पुराने को बदल देता है।

### Lock order (ताला लगाने का क्रम)
नियम: **session → participant → question → upvote row**। उल्टे क्रम में कोई lock नहीं, इसलिए deadlock (दो
transactions का एक-दूसरे का इंतज़ार) नहीं बनता।

- **Submit:** session `FOR SHARE` (ENDED या Q&A closed हो तो refuse) → participant `FOR NO KEY UPDATE` → इस
  participant के सवाल गिनो → insert।
- **Upvote:** session `FOR SHARE` → question `FOR SHARE` (unknown, hidden, या दूसरे session का → 404; अपना सवाल
  → 403)।
- **Q&A switch और end:** session `FOR UPDATE`। End `qna_open=false` भी करता है।
- **Pin:** session `FOR UPDATE` → question `FOR UPDATE` → दूसरे pinned सवाल को unpin → इसे pin।
- **Hide, restore, answer:** code में भी session `FOR UPDATE` → question `FOR UPDATE` (`moderateQuestion`, एक ही
  function सब changes संभालता है)।

### 5-सवाल की सीमा — participant row lock से (क्यों काम करता है)
समस्या: एक participant एक साथ 6 requests भेजे। अगर हर request पहले गिनती करे ("अभी 4 हैं") और फिर insert करे, तो
कई requests एक साथ "4" देखकर सब insert कर सकती हैं — 5 से ज़्यादा।

हल (`questions.service.ts` line 153–197): submit पहले उस participant की row पर `FOR NO KEY UPDATE` lock लेता है।
उसी participant की दूसरी request उसी row पर रुक जाती है, जब तक पहली commit न हो। PostgreSQL READ COMMITTED में हर
statement नया snapshot लेता है, इसलिए रुकी हुई request की COUNT पहली का committed सवाल देखती है। नतीजा: सवाल एक-एक
करके गिने जाते हैं, और छठा `409 QUESTION_LIMIT_REACHED` पाता है।

`NO KEY UPDATE` ही क्यों, साधारण `UPDATE` क्यों नहीं? Foreign key check (जैसे `questions.participant_id` का insert)
parent row पर `KEY SHARE` lock लेता है। `FOR UPDATE` उसे रोक देता, पर `NO KEY UPDATE` नहीं रोकता — इसलिए दूसरे काम
बेवजह नहीं अटकते। Test: "six parallel questions from one participant produce exactly five"।

### Close/end बनाम submit
Switch और end session `FOR UPDATE` लेते हैं, इसलिए वे चल रहे submits (जो `FOR SHARE` पकड़े हैं) के commit का
इंतज़ार करते हैं। इंतज़ार कर रहा submit बाद में locked session को फिर पढ़ता है और `409 QNA_CLOSED` पाता है। End
बनाम submit: `409 SESSION_ENDED` (यह `QNA_CLOSED` से **पहले** जाँचा जाता है)। नतीजा हमेशा एक साफ़: close से पहले
store, या साफ़ संदेश से refuse — close के बाद कभी store नहीं।

### Counted upvotes — गिनती store क्यों नहीं
अगर `questions` पर एक `upvotes` counter column होता, तो हर upvote को उसी question row को update करना पड़ता। दो लोग
एक साथ upvote करें तो दोनों उसी row के lock के लिए लड़ते (और session/question locks के साथ deadlock का ख़तरा)।
इसलिए हर upvote बस एक नई row है, और count `COUNT(*)` से पढ़ा जाता है। Upvotes एक-दूसरे को नहीं रोकते (सब question
`FOR SHARE` लेते हैं)। `docs/03` भी इसी हिसाब से अपडेट हुआ।

### एक क्रम हर screen के लिए
`ORDER BY pinned DESC, upvotes DESC, created_at ASC, id ASC` (`QUESTION_ORDER`)। Browser दोबारा sort नहीं करता।

### कौन क्या देखता है
- Participant list: `WHERE hidden = false` और एक ही mapper `toParticipantQuestion` (`mine`, `myUpvote` जोड़ता है;
  participant id कभी नहीं)। Mapper hidden row मिलने पर ख़ुद error फेंकता है — दूसरी सुरक्षा।
- Hidden सवाल upvote नहीं हो सकते (unknown जैसा 404 — उसका होना भी पता नहीं चलता), इसलिए उनकी गिनती नहीं बदलती।
- Presenter hidden सवाल सिर्फ़ HTTP से देखता है।

### Room का नियम और version
सारे Q&A events `session:<id>` room में जाते हैं। Session id हमेशा question की row से आता है, caller से कभी नहीं।
- `question:created` भेजने से **पहले** सवाल ताज़ा पढ़ा जाता है; अगर इस बीच hide हो गया तो कुछ नहीं भेजा जाता।
- `question:upvotes` ~250 ms (`UPVOTES_COMBINE_MS`) में इकट्ठा होता है, सिर्फ़ visible सवालों की counts server के
  क्रम में। **`version` = session की कुल upvote rows** (hidden सवालों की भी, इसलिए hide करने पर version कभी घटता
  नहीं)। दोनों reads एक REPEATABLE READ snapshot में। Client सिर्फ़ नया (बड़ा) version लागू करता है
  (`questions-merge.ts`)।

### Contracts (socket events, server → client)

| Event | Room | Payload | Client क्या करता है |
|---|---|---|---|
| `question:created` | session | `{ question: PublicQuestion }` (ताज़ा पढ़ा; hidden हो तो नहीं भेजा) | जोड़ता है |
| `question:upvotes` | session | `{ version, questions: [{ id, upvotes }] }` | Version नया हो तो लागू |
| `question:updated` | session | `{ questionId }` | Refetch |
| `qna:status` | session | `{ open }` | Refetch |

Clients हर connect और `session:ended` पर भी refetch करते हैं। किसी payload में participant id, नाम या voters नहीं।

### HTTP contracts (सार)

| Method / path | कौन | Success | Errors |
|---|---|---|---|
| POST `/sessions/by-code/:code/questions` | Participant (body से पहले cookie) | 201 `{ question }` | 400 (field `text`), 401, 404, 409 `SESSION_ENDED` / `QNA_CLOSED` / `QUESTION_LIMIT_REACHED` / `QUESTION_ALREADY_ASKED`, 429 |
| GET `/sessions/by-code/:code/questions` | Participant | 200 `{ qnaOpen, questions }` | 401, 404 |
| GET `/sessions/:id/questions` | Presenter | 200 `{ qnaOpen, questions }` (hidden सहित) | 401, 404 |
| POST `/questions/:id/upvotes` | उसी session का participant | 201 `{ questionId, myUpvote: true }` | 401, 403 `OWN_QUESTION`, 404, 409 `SESSION_ENDED` / `QNA_CLOSED` / `UPVOTE_ALREADY_RECORDED`, 429 |
| PATCH `/questions/:id` | उसी session का presenter | 200 | 400, 401, 404 (और pin पर 409 `QUESTION_HIDDEN` / `QUESTION_PIN_CONFLICT`, code से) |
| PATCH `/sessions/:id/settings` | Presenter | 200 `{ qnaOpen }` | 400, 401, 404, 409 `SESSION_ENDED` |

POST और PATCH origin check से गुज़रते हैं (`router.use(createOriginCheck(...))`)।

### Impact analysis
- **Breaking:** Session model में `qnaOpen`; `endSession` Q&A भी बंद करता है; `Realtime` में नए senders (test fakes
  बदले); `initModels` में दो models। `docs/04` (`/upvotes`) और `docs/05` (कोई socket command नहीं) बदले। Events
  additive।
- **Migrations:** (1) `add-qna-open-to-sessions` additive; `down` column हटाता है (सिर्फ़ switch की स्थिति जाती है)।
  (2) `create-questions-and-upvotes` का `down` **सारा Q&A data मिटाता है** — approval तक सिर्फ़ test DB।
- **Security:** hidden सवाल server से बाहर नहीं (एक SQL filter, एक mapper, भेजने से पहले ताज़ा read); text सिर्फ़
  React text nodes; दूसरे session का upvote refuse; PATCH routes presenter cookie जाँचते हैं। बचा जोखिम: create के
  commit और hide के बीच कुछ milliseconds (स्वीकार, test के साथ)।

---

## 6. घड़ी (clock) की कहानी

Q&A के समय-stamps — `sessions.ended_at`, `qna_open` बदलने पर `updated_at`, `answered_at` — अब **database की घड़ी**
(`clock_timestamp()`) से आते हैं, polls और word cloud की तरह (`sessions.service.ts` line 124–131, 183–187;
`questions.service.ts` line 289–294)।

क्यों? दो घड़ियाँ हैं: Node process की और PostgreSQL की। दोनों अलग-अलग चलती हैं और कुछ milliseconds आगे-पीछे हो
सकती हैं। `questions.created_at` database की घड़ी से भरता है। अगर `ended_at` Node की घड़ी से आता, तो कोई सवाल जो
सच में end से **पहले** store हुआ, उसका `created_at` end के बाद का दिख सकता था — और test "end के बाद कोई सवाल
store नहीं" ग़लत fail होता। एक ही घड़ी से तुलना हमेशा सही होती है।

दूसरी बारीकी: `clock_timestamp()` lock **मिलने के बाद** पढ़ा जाता है। इसलिए पहले row `FOR UPDATE` lock होती है,
फिर stamp। (रुका हुआ सीधा `UPDATE` समय इंतज़ार से पहले ही पढ़ लेता है।) Tracking: "Q&A session stamps (ended_at,
qna updated_at) now come from the database clock, like the other features"।

---

## 7. Tasks (v1) — tracking table की असली स्थिति

सभी 14 tasks `planning-tracking.md` में `verified` दर्ज हैं।

| # | Task | Complexity | Executor | Status | Notes (tracking से) |
|---|---|---|---|---|---|
| 1 | Shared Q&A schemas, textKey, bodies, DTOs | MEDIUM | executor-medium | verified | shared 100 tests |
| 2 | Shared question और qna event schemas | LOW | executor-low | verified | event schemas |
| 3 | दो generated migrations | HIGH | executor-high | verified | test DB पर up/down/up; probes ने अपेक्षित errors दिए |
| 4 | Models, `Session.qnaOpen`, associations, truncate helper | MEDIUM | executor-medium | verified | 5 model tests |
| 5 | `questions.service`: submit (locks + cap), lists (SQL order, mappers), moderate | HIGH | executor-high | verified | cap race 6 → 5; pin race में एक pinned; 13 tests |
| 6 | `question-upvotes.service` | HIGH | executor-high | verified | own-question 403; hidden 404; switch tests के साथ 16 tests |
| 7 | `setQnaOpen` और `endSession` Q&A बंद करे | HIGH | executor-high | verified | close और end races |
| 8 | Realtime senders, combined upvotes, fresh reads, shutdown, stubs | HIGH | executor-high | verified | hidden कभी नहीं भेजा; 8 tests |
| 9 | Controller, routes, settings route, limiters, commit के बाद emit | MEDIUM | executor-medium | verified | end emit; 17 route tests |
| 10 | Cross-cutting secrecy और race tests | HIGH | executor-high | verified | 5 बार की series clean; timing checks एक घड़ी पर |
| 11 | Web client, reducer, hooks, merge | MEDIUM | executor-medium | verified | web 122 tests (उस समय) |
| 12 | Presenter `QnaPanel` (hidden section, pin, answer, switch) | MEDIUM | executor-medium | verified | असली error codes; browser में नहीं देखा |
| 13 | Participant view (बड़ा upvote button, "Your question", paused) | MEDIUM | executor-medium | verified | upvote 56px; browser में नहीं देखा |
| 14 | Docs और tracking | LOW | executor-low | verified | docs 02, 03, 04, 05, 07 अपडेट (English) |

---

## 8. Execution groups और मुख्य पल

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

### 1. Migrations: up / down / up और probes (G2)
दोनों migrations एक-एक transaction में चलती हैं। `add-qna-open-to-sessions`: column जोड़ो → ended sessions पर
`qna_open = false` backfill → CHECK `sessions_qna_closed_when_ended`। उसका `down` पहले constraint, फिर column हटाता है।
`create-questions-and-upvotes` में partial unique pin index है, और `down` के ऊपर WARNING comment कि वह सारे सवाल और
upvotes मिटाता है। Test DB पर up → down → up चला, और constraint probes (जानबूझकर ग़लत inserts) ने अपेक्षित errors
दिए (tracking task 3)। `qna-models.test.ts` यही नियम दोहराता है: default open, दूसरा pin refuse, वही text दोबारा
refuse, दूसरा upvote refuse, session delete पर cascade।

### 2. Database check ने 27 end-session tests तोड़े — plan की असली कमी (G4)
नया CHECK कहता है: session ENDED है तो `qna_open` false होना ही चाहिए। पर पुराना `endSession` सिर्फ़ `status =
'ENDED'` करता था, `qna_open` को true छोड़ देता था — database ने हर end को refuse कर दिया, और session end करने वाले
**27 tests fail** हुए। यह plan की असली कमी थी (Key decision 1 में "End also sets `qna_open=false`" लिखा था, पर
end के बदलाव और नए constraint के बीच का क्रम नहीं)। हल: `endSession` अब उसी `UPDATE` में `qna_open = false` भी
करता है (`sessions.service.ts` line 124–131)। Test: "ending the session closes Q&A"। सबक़: constraint जोड़ने से पहले
देखें कि मौजूदा कौन-से writes उसे तोड़ेंगे।

### 3. Cap race (G4)
6 parallel submits एक participant से → ठीक 5 सवाल। Participant row का `NO KEY UPDATE` lock ही इसे पक्का करता है
(ऊपर section 5)। यह service test और `qna-races.test.ts` दोनों में है।

### 4. Realtime senders (G5)
`createQuestionEmitters` (`realtime/questions.ts`): `emitQuestionCreated` ताज़ा पढ़ता है और hidden हो तो चुप;
`scheduleUpvotes` 250 ms में burst को एक update बनाता है; `emitUpvotesNow` pending timer रद्द करके तुरंत भेजता है
(hide/unhide या pin के बाद); `clearQuestionTimers` shutdown पर सब रोकता है। कोई sender throw नहीं करता; logs में
सवाल का text नहीं, सिर्फ़ session id। `createLoadQuestion` explicit fields से `PublicQuestion` बनाता है, ताकि
`hidden` या कोई और field साथ न जाए।

### 5. Routes और settings route (G6)
`questions.routes.ts`: submit पर limiter (120/min) → params → participant auth (`submitAuth`) → body validation →
controller; upvote पर limiter (300/min) → auth → controller; PATCH पर body validation, presenter जाँच controller में।
Settings route `PATCH /sessions/:id/settings` sessions router में है; Q&A सच में बदले तभी `qna:status` जाता है।
Session end पर भी `qna:status` (test: "ending a session emits the Q&A closed status")।

### 6. Word-cloud का flaky (कभी-कभी fail होने वाला) test
Q&A के काम के दौरान पुराना word-cloud race test "ending a session while a submission is in flight counts that word
and closes the prompt exactly once" (`api/tests/integration/wordcloud-races.test.ts`) लगभग 5 में से 1 run में fail
हुआ। क्रम:
1. पहली वजह: `closed_at` के क्रम पर assertion — timing और ordering की समस्या। हल: stamp से पहले lock (section 6)।
2. फिर एक fail **5 सेकंड के default timeout** से आया; test का timeout 30 s किया गया।
3. आख़िरी fail फिर timeout था। Developer के निर्देश पर (2026-10-24) test **skip** किया गया। नीचे section 10 देखें।

### 7. एक साथ चले दो full-suite runs — सामूहिक failures
एक full-suite run तब शुरू हुआ जब दूसरा अभी चल रहा था। दोनों **एक ही test database** इस्तेमाल करते हैं, इसलिए
एक run दूसरे की tables truncate कर रहा था — बहुत से tests एक साथ fail हुए। यह code का bug नहीं था। नियम: suite
एक समय में एक ही चलाएँ।

### Web की बातें (code से)
- `ParticipantQna.tsx`: "Your question is in.", "Your question" badge, ख़ाली होने पर "No questions yet. Be the first
  to ask.", paused संदेश "Q&A is paused by the presenter." (`qna-messages.ts`); `aria-live="polite"` सिर्फ़ गिनती वाली
  line पर, list पर नहीं।
- `QnaPanel.tsx`: Pinned badge, Pin/Unpin, hidden section, answer form, switch; ख़ाली: "No questions yet.
  Participants can ask from their phones."
- `questions-merge.ts`: snapshot और live counts में बड़ा `version` जीतता है; सिर्फ़ snapshot में दिख रहे सवालों की
  counts लागू।

---

## 9. Verification — इस run में असल में क्या चला

| Check | नतीजा |
|---|---|
| lint | 0 |
| typecheck | 0 |
| unit tests | api 52 + shared 100 + web 133 pass |
| prettier | 0 |
| web build | 0 (सफल) |
| integration (असली Postgres + असली Redis) | **311 pass, 1 skipped** (skipped = word-cloud race test, section 10) |
| live end-to-end | **28/28 checks pass** |

(ये नंबर इस stage के final run से हैं; यह document लिखते समय commands दोबारा नहीं चलाए गए।)

### Live end-to-end (28 checks, असली run)
Dev servers पर (API पोर्ट 4000, web पोर्ट 3000) असली HTTP और socket clients से 28 checks चले — सब PASS। Run के बाद temporary script हटा दी गई।

| # | Check | नतीजा |
|---|---|---|
| 1 | create session | PASS |
| 2 | two participants join | PASS |
| 3 | presenter और दो participants live connected | PASS |
| 4 | participant A सवाल पूछता है (201) | PASS |
| 5 | participant B सवाल पूछता है (201) | PASS |
| 6 | participants को `question:created` मिला | PASS |
| 7 | अपना सवाल upvote नहीं हो सकता (403) | PASS |
| 8 | A, B के सवाल को upvote करता है (201) | PASS |
| 9 | दूसरा upvote refuse (409) | PASS |
| 10 | participant list में B का सवाल सबसे ऊपर (1 upvote), A के लिए `mine` सही | PASS |
| 11 | presenter सवाल hide करता है (200) | PASS |
| 12 | hidden सवाल participant list से हट जाता है | PASS |
| 13 | presenter की list में hidden सवाल अब भी दिखता है | PASS |
| 14 | hide के बाद hidden सवाल का text participants तक नहीं पहुँचा (कमज़ोर check — नीचे देखें) | PASS |
| 15 | presenter सवाल restore करता है (200) | PASS |
| 16 | restore के बाद सवाल अपने upvote के साथ लौटता है | PASS |
| 17 | presenter सवाल pin करता है (200) | PASS |
| 18 | pinned सवाल list में पहले है | PASS |
| 19 | presenter answer के साथ answered mark करता है (200) | PASS |
| 20 | answer plain text के रूप में रहता है, markup literal | PASS |
| 21 | presenter Q&A pause करता है (200) | PASS |
| 22 | pause के दौरान सवाल refuse (409 QNA_CLOSED) | PASS |
| 23 | presenter Q&A reopen करता है (200) | PASS |
| 24 | reopen के बाद सवाल फिर स्वीकार (201) | PASS |
| 25 | participant messages में कोई secret या cookie value नहीं | PASS |
| 26 | end session (200) | PASS |
| 27 | participants को `session:ended` और `qna:status` (closed) मिला | PASS |
| 28 | session end होने के बाद सवाल refuse (409) | PASS |

**नतीजा: 28 में से 28 PASS।**

**ध्यान दें (hidden text check):** hide के बाद hidden text न आने वाला e2e check अटपटे तरीक़े से लिखा था और
**component और race/secrecy tests से कमज़ोर** है। असली सबूत `qna-secrecy.test.ts`, `qna-live.test.ts` और
component tests हैं।

### Tests — कौन सी file क्या साबित करती है

| File | Tests | क्या साबित करता है |
|---|---|---|
| `integration/qna-models.test.ts` | 5 | Default open; दूसरा pin, वही text, दूसरा upvote DB refuse करता है; cascade delete |
| `integration/questions-service.test.ts` | 13 | Store बिना voter पहचान; छठा refuse; 6 parallel → 5; वही text (case/spaces अनदेखे) 409; closed/ended (ended पहले); क्रम pinned→upvotes→पुराना; hide/restore upvotes के साथ; pin बदलना और pin race; hidden pin 409; hide unpin करता है; जवाब store/replace/clear, markup plain; `mine`/`myUpvote` |
| `integration/upvotes-service.test.ts` | 6 | दूसरा upvote 409; अपना 403; hidden 404; दूसरा session 404; closed/ended refuse; `upvotesFor` visible-only, version सिर्फ़ बढ़ता |
| `integration/upvotes-races.test.ts` | 4 | Identical = 1; दो tabs = 1; दो participants = 2; close बनाम upvote एक साफ़ नतीजा |
| `integration/qna-switch.test.ts` | 6 | Close पर `QNA_CLOSED`; reopen; ended को open = `SESSION_ENDED`; ended को close = 200; end Q&A बंद करता है; unknown 404 |
| `integration/questions-routes.test.ts` | 17 | 201 बिना पहचान; दूसरे session का 401; 409 limit/already-asked/closed; 400 field `text` बिना echo; upvote 201 फिर 409; 403; hidden 404; participant/presenter lists; hide/restore; no-op कुछ emit नहीं और दूसरे presenter को 401; pin बदलना; settings route; rate limit; end पर closed status |
| `integration/qna-races.test.ts` | 8 | Cap 6 → 5; identical सवाल = 1; दो tabs upvote = 1; दो participants = 2; pause बनाम सवाल; hide बनाम upvote; end बनाम सवाल; दो pins → एक |
| `realtime/qna-live.test.ts` | 8 | नया सवाल सबको; hidden नहीं भेजा; combined counts final version के साथ; burst = एक update; status सबको; update सबको; दूसरा session कुछ नहीं पाता; failed send throw नहीं |
| `realtime/qna-secrecy.test.ts` | 5 | Hidden किसी route से participants तक नहीं; `mine`/`myUpvote` सिर्फ़ अपने लिए; restore upvote के साथ; फिर hide के बाद text नहीं; किसी message में पहचान नहीं |

---

## 10. खुला issue — skipped word-cloud race test

- **Test:** "ending a session while a submission is in flight counts that word and closes the prompt exactly once"
  (`api/tests/integration/wordcloud-races.test.ts`)।
- **स्थिति:** **SKIPPED** — developer के निर्देश पर (2026-10-24)। इसीलिए integration में 311 pass के साथ 1 skipped है।
- **वजह:** intermittent (कभी-कभी होने वाली) failure, लगभग 5 में से 1 run। पहले timing और ordering की समस्या
  (`closed_at` का क्रम; stamp से पहले lock करके ठीक किया), आख़िरी failure 5 सेकंड का timeout (test 30 s पर किया,
  फिर भी आख़िरी fail timeout था)।
- **असली वजह अभी पक्की नहीं।** वजह confirm होने के बाद इस test को **फिर से चालू (re-enable) करना ज़रूरी** है। जब तक
  यह skipped है, "end बनाम चल रहा word submission" का यह race test से नहीं जाँचा जा रहा।

---

## 11. नहीं जाँचा गया (NOT VERIFIED)

1. **असली browser में UI का रूप** — presenter panel और participant view का layout, pinned border, 56px upvote button;
   सिर्फ़ component tests और build से जाँचे।
2. **असली browser में live updates** — नया सवाल, upvote से क्रम बदलना, hide, pause दो असली browsers में नहीं देखे।
3. **Skipped word-cloud race test** — ऊपर section 10।
4. **Moderation reply typed नहीं** — web में PATCH का जवाब schema से validate नहीं होता; client बिना data के ok
   लौटाता है।
5. **Realtime burst test की timing** — test मानता है कि तीन upvotes 150 ms के अंदर पहुँचें; धीमी machine पर अस्थिर
   हो सकता है।
6. **e2e hidden-text check कमज़ोर** — component और race tests से कमज़ोर (section 9)।
7. **Live e2e का hidden-text check कमज़ोर है** — component और race tests पर भरोसा।

---

## 12. Issues और जोखिम

`planning-tracking.md` के "Issues & updates" से:

- **2026-10-24 · MEDIUM (OPEN) — intermittent word-cloud race test:** ऊपर section 10। Note: एक full-suite run दूसरे
  के चलते शुरू हुआ तो सामूहिक failures हुए (दोनों एक test database share करते हैं); suite एक बार में एक चलाएँ।
- **2026-10-24 · LOW — clock consistency:** Q&A session stamps (`ended_at`, qna `updated_at`) अब database clock से
  (सुलझा)।
- **2026-10-24 · LOW — moderation reply typed नहीं (web):** PATCH reply schema से validate नहीं; आज काम करता है, typed
  होना चाहिए।
- **2026-10-24 · LOW — realtime burst test timing:** तीन upvotes 150 ms में; धीमी machine पर संवेदनशील।
- **2026-10-24 · LOW — live e2e hidden-text check:** अटपटा लिखा, component और race tests से कमज़ोर।

Requirement और plan से अतिरिक्त जोखिम:
- **RISK (HIGH, घटाया) — hidden सवाल का leak:** एक SQL filter, एक mapper, भेजने से पहले ताज़ा read; secrecy tests हर
  participant response और message जाँचते हैं।
- **RISK (स्वीकार) — create और hide के बीच कुछ milliseconds:** सवाल hide होने से ठीक पहले `question:created` जा सकता
  है; test के साथ स्वीकार।
- **RISK (MEDIUM) — spam:** 5-सवाल सीमा, rate limits और hide; AI moderation बाद में।
- **RISK — कोई pagination नहीं:** prototype की सीमा।
- **RISK — destructive `down`:** `create-questions-and-upvotes` का `down` सारा Q&A data मिटाता है; असली data पर
  approval ज़रूरी।

---

## 13. अगले कदम

1. Commit का फ़ैसला — **आप** करेंगे (Claude नहीं); Stage 3, 4, 5 और 6 का code अभी uncommitted है।
2. Skipped word-cloud race test की असली वजह confirm करके उसे **फिर चालू** करना।
3. दो असली browsers में polls, word cloud और Q&A — तीनों का UI और live updates हाथ से देखना।
4. Hidden-text e2e check को मज़बूत लिखना।
5. अगला feature चुनना — roadmap में अगला **reactions** (`live-reactions`, Phase 8) है, फिर **AI** (`ai-foundation`,
   Phase 9)। आपकी स्पष्ट approval के बिना शुरू नहीं होगा।
