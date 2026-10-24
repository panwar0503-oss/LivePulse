# Stage 05 — Word Cloud (शब्दों का बादल)

> स्रोत (source): `requirements/word-cloud/requirement.md`, `requirements/word-cloud/planning-tracking.md`, और असली
> code (`shared/src/schemas/word-cloud.ts`, `api/src/services/word-prompts.service.ts`,
> `api/src/services/word-responses.service.ts`, `api/src/services/sessions.service.ts` का `endSession`,
> `api/src/realtime/word-cloud.ts`, `api/src/controllers/word-prompts.controller.ts`,
> `api/src/routes/word-prompts.routes.ts`, `api/migrations/20261024105906-create-word-prompts-and-responses.cjs`,
> `web/src/components/word-cloud/`, `web/src/hooks/word-cloud-merge.ts`) और `api/tests/integration/` व
> `api/tests/realtime/` के word-cloud tests। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Presenter एक खुला सवाल (prompt) पूछता है, जैसे "One word for how you feel about AI at work?"; हर participant उस
prompt के लिए **एक** शब्द या छोटा phrase भेजता है; सबको एक live word cloud दिखता है जिसमें ज़्यादा बार आए शब्द बड़े
दिखते हैं। Presenter तय करता है कि participants cloud देखें या नहीं (hide/show), और prompt बंद (close) करने पर नए
शब्द आने बंद हो जाते हैं, पर final cloud बना रहता है। यह feature AI नहीं है — गिनती exact और deterministic (हर बार
एक जैसी) है। यह roadmap का **Phase 6** है (`docs/08-implementation-plan.md`)।

### Git की स्थिति (commit)

सबसे नया commit अब भी `1f6937f foundation and session and join work` है। Stage 3, Stage 4 और यह stage — तीनों का
code **अभी commit नहीं हुआ है**। Commit आप करेंगे।

---

## 2. Requirement का सार — व्यापार की भाषा में

File: `requirements/word-cloud/requirement.md` — Status `completed` (line 5)।

### कौन इस्तेमाल करता है
- **Presenter** — prompt खोलता (open) और बंद करता है, तय करता है कि participants cloud देखें या नहीं, counts पढ़ता है।
- **Participant** — हर prompt के लिए एक शब्द या phrase भेजता है; अनुमति हो तो cloud देखता है।

### Key behaviours (मुख्य व्यवहार) 1–14

| # | व्यवहार (हिंदी में) | Notes |
|---|---|---|
| 1 | Presenter सवाल के साथ prompt बनाता है | सवाल 200 अक्षर तक (polls जैसा) |
| 2 | Session में एक समय में सिर्फ़ एक prompt खुला | नया prompt खोलने पर पिछला बंद हो जाता है |
| 3 | Participant हर prompt में एक शब्द/phrase भेजता है | Trim होता है; ख़ाली refuse; 30 अक्षर तक |
| 4 | एक जैसे जवाब साथ गिने जाते हैं — case और extra spaces को अनदेखा करके | "Work life", "work  LIFE", " work life " = एक entry |
| 5 | हर entry का पढ़ने लायक रूप (display) रहता है | सबसे आम spelling दिखती है, normalised key नहीं |
| 6 | सबसे ज़्यादा आए शब्द पहले, तय क्रम में | ज़्यादा से ज़्यादा 30 entries; बराबरी पर alphabetical, ताकि क्रम उछले नहीं |
| 7 | Participant का शब्द final है | दूसरा शब्द refuse; retry दूसरा शब्द नहीं जोड़ता |
| 8 | Text हमेशा plain text | Markup जैसा टाइप हुआ वैसा दिखता है, कभी चलता (run) नहीं |
| 9 | Presenter हर prompt के लिए तय करता है कि participants cloud देखें | Default on; फ़ैसला server का; छुपा cloud participants को कभी नहीं भेजा जाता |
| 10 | Close करते ही सारे submissions रुकते हैं | Close के साथ आए शब्द का एक ही साफ़ नतीजा |
| 11 | Closed prompt का final cloud presenter के पास रहता है | अनुमति हो तो participants भी देखते हैं |
| 12 | Reload करने पर participant को अपना शब्द दिखता है, दोबारा नहीं भेज सकता | शब्द marked दिखता है |
| 13 | ख़ाली cloud पर दोस्ताना संदेश, error नहीं | "No words yet. Answers will appear here." |
| 14 | Session ख़त्म होने पर खुला prompt बंद | End के बाद कोई submission नहीं |

### Scope
- **In:** prompt बनाना; open और close; एक समय में एक खुला prompt; हर participant का एक शब्द, normalisation और
  length नियमों के साथ; presenter के लिए live cloud; अनुमति पर participants के लिए live cloud; per-prompt show/hide;
  reconnect/reload पर recovery; दोस्ताना empty state।
- **Out:** AI या मिलते-जुलते शब्दों का grouping ("teamwork" और "collaboration"), शब्द edit/delete, अनुचित शब्दों का
  moderation, images या सिर्फ़-emoji जवाब, एक बार में कई शब्द, cloud export।

### Success criteria (सफलता की कसौटी) 1–11
1. Presenter prompt खोलता है; जुड़े participant को बिना refresh दिखता है।
2. दूसरा prompt खोलने पर पहला बंद; room को सिर्फ़ खुला prompt दिखता है।
3. सिर्फ़ case या spaces में अलग दो जवाब = एक entry, जुड़ी हुई count के साथ।
4. ख़ाली, सिर्फ़-spaces और 30 से ज़्यादा अक्षर वाले जवाब साफ़ संदेश से refuse।
5. एक participant का एक ही शब्द दो बार, या दो tabs से = एक count।
6. Cloud छुपा हो तो किसी participant response या message में कोई शब्द या count नहीं।
7. Cloud दिखता हो तो participants को live update दिखता है।
8. Close के बाद आया शब्द refuse; close के साथ आया शब्द एक साफ़ नतीजा देता है (concurrency test से जाँचा)।
9. टाइप किया markup cloud और presenter view में plain text दिखता है।
10. ख़ाली cloud पर दोस्ताना संदेश, error नहीं।
11. Session end खुला prompt बंद करता है और बाद के submissions refuse करता है।

---

## 3. स्पष्टीकरण (clarification) के सवाल और जवाब

Requirement का change log (line 134): *"Created and confirmed (one open prompt; 30-character limit; show-cloud switch
per prompt, default on; submissions final)"*।

| # | सवाल | जवाब (developer ने चुना) |
|---|---|---|
| — | एक समय में कितने खुले prompts? | **एक** open prompt प्रति session |
| — | जवाब की लंबाई? | **30 अक्षर** तक (सवाल 200 तक) |
| — | Cloud दिखाने का फ़ैसला? | **हर prompt का अपना show-cloud switch**, default on |
| — | शब्द बदल सकते हैं? | नहीं, **submission final** |
| Q1 | Submission rate limit? | **300 प्रति minute प्रति IP** |
| Q2 | Prompt खुला हो और नया start हो तो? | **Start पिछले prompt को बंद कर देता है** (polls से अलग — वहाँ दूसरा start refuse होता है) |
| Q3 | Draft (मसौदा) step रखें? | **हाँ** — पहले create, फिर open |
| Q4 | Normalisation कितना? | **Invisible (अदृश्य) characters हटाना और NFC** भी शामिल |
| Q5 | Retry पर क्या लौटे? | **409 `WORD_ALREADY_SUBMITTED`** (recommended, स्वीकार) |

### Defaults जो बिना पूछे लिए गए
- **50 prompts प्रति session** (उससे ऊपर `409 PROMPT_LIMIT_REACHED`)।
- Retry पर 409 (ऊपर Q5) — planner की सिफ़ारिश, developer ने स्वीकार की।

### Approvals
- Plan v1 developer ने 2026-10-24 को approve किया।
- नए packages: कोई नहीं।
- Destructive `down` migration: सिर्फ़ test DB पर, जब तक approval न हो।

---

## 4. Normalisation — शब्द को एक जैसा बनाना

Code: `shared/src/schemas/word-cloud.ts` का `normaliseWord(raw) → { display, key }`। क्रम:

1. **Control और zero-width (format) characters हटाओ** (`\p{Cc}` और `\p{Cf}`)। Tab, newline जैसे whitespace नहीं
   हटते — वे अगले step में एक space बनते हैं (वरना `"a\tb"` → `"ab"` हो जाता)।
2. **Trim** — शुरू और अंत के spaces हटाओ।
3. **Whitespace collapse** — बीच के कई spaces/tabs को एक space।
4. **NFC** — Unicode का एक मानक रूप, ताकि एक ही अक्षर के दो अलग encodings एक बनें।
5. `key = display.toLowerCase()` — accents (मात्रा जैसे चिह्न, é) रखे जाते हैं।

Zod schema (`wordTextSchema`): पहले raw ≤ 200 अक्षर (काम सीमित रखने के लिए), फिर normalise, फिर display 1–30 अक्षर।
संदेश: "Type a word or short phrase." / "Use 30 characters or fewer."

### उदाहरण

| Input | display | key | नतीजा |
|---|---|---|---|
| `"Work life"` | `Work life` | `work life` | — |
| `"  work    LIFE  "` | `work LIFE` | `work life` | ऊपर वाले के साथ **एक entry** `work life`, count 2 |
| सिर्फ़ zero-width characters | `` (ख़ाली) | `` | 400 — "Type a word or short phrase." |
| `"<b>"` | `<b>` | `<b>` | Plain text की तरह store और render; कभी HTML नहीं बनता |

दोनों पहले जवाबों की entry में display कौन सा दिखेगा? Cloud SQL हर key की **सबसे आम spelling** चुनता है; बराबरी पर
`display_word COLLATE "C"` (byte order) में पहला — इसलिए `Work life` (बड़ा `W` byte order में छोटे `w` से पहले आता है)।
नतीजा: एक entry, display "Work life", count 2।

---

## 5. Plan v1 का सार

### Architecture (ढाँचा)
- **DB:** दो नई tables `word_prompts`, `word_responses` — एक additive migration।
- **API:** `POST/GET /api/sessions/:id/word-prompts`, `POST /api/word-prompts/:id/start`,
  `POST /api/word-prompts/:id/close`, `PATCH /api/word-prompts/:id` (`{ showCloud }`),
  `POST /api/word-prompts/:id/responses` (`{ text }`), `GET /api/sessions/by-code/:code/word-prompts/current`।
- **Realtime:** `wordcloud:started`, `wordcloud:closed`, `wordcloud:updated` → session room; `wordcloud:results` →
  छुपा हो तो presenter room, दिखता हो तो session room। सब commit के **बाद**।
- **Web:** presenter page → `WordPromptsPanel`; `ParticipantClient` → `LiveParticipantWordPrompt`।

### DB की invariants (नियम जो database ख़ुद लागू करता है)
1. **Partial unique index `word_prompts_one_active_per_session`** — `ON word_prompts (session_id) WHERE status =
   'ACTIVE'`। एक session में दूसरा ACTIVE prompt commit ही नहीं हो सकता — races के ख़िलाफ़ आख़िरी पहरेदार।
2. **Unique `(prompt_id, participant_id)`** (`word_responses_prompt_participant_key`) — एक participant का एक prompt
   में एक शब्द। `submitWord` इस constraint के `UniqueConstraintError` को transaction callback के **बाहर** पकड़कर
   `409 WORD_ALREADY_SUBMITTED` में बदलता है।
3. बाक़ी: CHECK `(status = 'CLOSED') = (closed_at IS NOT NULL)`; सवाल, `normalized_word` और `display_word` ख़ाली नहीं;
   `display_word` `VARCHAR(30)`; FKs पर CASCADE; index `(prompt_id, normalized_word)`।

### Lock order (ताला लगाने का क्रम)
- नियम polls जैसा: **session पहले, फिर prompt**।
- **Start:** session `FOR UPDATE` (एक session के दो starts कतार में लगते हैं) → target prompt `FOR UPDATE` → खुले
  prompt को `CLOSED` करने वाला `UPDATE` (यह चल रहे submissions के commit का इंतज़ार करता है) → फिर target ACTIVE।
  पुराना पहले बंद होता है, इसलिए one-active index कभी नहीं टकराता।
- **Submit:** prompt `FOR SHARE` (session lock नहीं) — एक साथ आए शब्द एक-दूसरे को नहीं रोकते।
- **Close** और **show-cloud switch:** prompt `FOR UPDATE`।
- **Create:** session `FOR SHARE`, ताकि end इसके commit तक रुके।
- **End:** session `FOR UPDATE`, फिर उसी transaction में खुला prompt `CLOSED` (`closed_at = clock_timestamp()`, यानी
  lock wait के बाद का समय) — `sessions.service.ts` line 125–134।

### Top-30 cloud — database में
`getWordCloud` एक ही SQL query चलाता है (`word-prompts.service.ts` line 63–77):
- हर key की count; क्रम **count desc, फिर `key COLLATE "C"` asc**; `LIMIT 30`।
- Display word = हर key की सबसे आम spelling, बराबरी पर `display_word COLLATE "C"`।
- Total window function से LIMIT से **पहले** गिना जाता है, इसलिए total हर response गिनता है।
- `version` = कुल responses (जवाब final हैं, इसलिए सिर्फ़ बढ़ता है)। Browser दोबारा sort नहीं करता।

### Combined broadcasts, fresh reads
Cloud updates हर prompt के लिए ~250 ms (`CLOUD_COMBINE_MS`) में इकट्ठे होते हैं। भेजते समय cloud और `showCloud`
दोनों database से **ताज़ा** पढ़े जाते हैं (`createLoadWordCloud`; visibility cloud के बाद पढ़ी जाती है ताकि सबसे नई
value इस्तेमाल हो)।

### Room का नियम
Fresh read में `showCloud` false → सिर्फ़ `presenter:<id>`; true → `session:<id>` (presenter भी उसमें है, इसलिए एक ही
room)। Session id prompt की row से आता है, caller से कभी नहीं।

### Per-recipient नियम
एक ही mapper `toParticipantPrompt`: `showCloud` false हो तो `cloud: null`; drafts कभी नहीं (null)। Submit response
`{ promptId, myWord }` — कोई count नहीं।

### Contracts (socket events, server → client)

| Event | Room | Payload |
|---|---|---|
| `wordcloud:started` | session | `{ prompt: { id, question, showCloud } }` (शब्द या counts नहीं) |
| `wordcloud:closed` | session | `{ promptId, closedAt }` (start या end से बंद होने पर भी) |
| `wordcloud:updated` | session | `{ promptId, showCloud }` (clients refetch करते हैं) |
| `wordcloud:results` | छुपा: presenter; दिखता: session | `{ promptId, total, version, entries }` |

### बाक़ी फ़ैसले
- Submissions HTTP पर (votes वाला कारण); पुराने docs का `word:submit` socket command हटाया गया।
- Closed prompt को दोबारा close = 200 बिना बदलाव। Show-cloud switch closed prompt पर भी चलता है।
- अलग GET cloud endpoint नहीं; cloud presenter list और participant current-prompt में ही है।
- Cloud एक Tailwind flex-wrap list है, rank के क्रम में, कुछ font-size steps के साथ; कोई layout library नहीं।
- Rate limits: submit 300/min/IP, create 60/min/IP।

### Impact analysis
- **Breaking:** `endSession` अब `{ session, closedPoll, closedPrompt }` लौटाता है; `Realtime` में word-cloud senders;
  test fakes बदले; `initModels` में दो models। Events additive।
- **Migration:** additive; `down` **सारा word-cloud data मिटाता है** — approval तक सिर्फ़ test DB।
- **Security:** छुपा cloud server से बाहर नहीं जाता; plain text सिर्फ़ React text nodes से, `dangerouslySetInnerHTML`
  नहीं; normalisation एक-जवाब नियम को bypass नहीं कर सकता (key participant है, शब्द नहीं)।

---

## 6. Tasks (v1) — tracking table की असली स्थिति

सभी 14 tasks `planning-tracking.md` में `verified` दर्ज हैं।

| # | Task | Complexity | Executor | Status | Notes (tracking से) |
|---|---|---|---|---|---|
| 1 | Shared `normaliseWord`, Zod bodies, DTOs | MEDIUM | executor-medium | verified | 18 tests |
| 2 | Shared wordcloud event schemas और map | LOW | executor-low | verified | word event schemas |
| 3 | Generated migration: constraints, partial index, destructive down | HIGH | executor-high | verified | test DB पर up/down/up; constraint probes ने अपेक्षित errors दिए |
| 4 | Models, associations, `Models` type, truncate helper | MEDIUM | executor-medium | verified | 5 word model tests |
| 5 | `word-prompts.service`: create, list, current, start (पिछला बंद), close, switch, cloud SQL, mappers | HIGH | executor-high | verified | 13 tests; top-30 ordering |
| 6 | `word-responses.service` `submitWord` | HIGH | executor-high | verified | 7 service tests; 6 race tests |
| 7 | `endSession` खुला prompt बंद करे | HIGH | executor-high | verified | 5 end tests |
| 8 | Realtime senders, combined updates, shutdown, test stubs | HIGH | executor-high | verified | 7 realtime tests |
| 9 | Controller, routes, rate limits, commit के बाद emit | MEDIUM | executor-medium | verified | 14 route tests; word field mapping |
| 10 | Cross-cutting secrecy और race tests | HIGH | executor-high | verified | 5 secrecy और 4 race tests; race file clean |
| 11 | Web client, socket reducer, hooks, version merge | MEDIUM | executor-medium | verified | web 98 tests (उस समय) |
| 12 | Presenter panel, create form, `WordCloud` (empty message, `aria-live="polite"`, सिर्फ़ text) | MEDIUM | executor-medium | verified | plain text, server का क्रम; browser में नहीं देखा |
| 13 | Participant view (बड़ा input, "Your word is in.", closed और hidden states) | MEDIUM | executor-medium | verified | browser में नहीं देखा |
| 14 | Docs 02, 03, 04, 05, 07 और tracking | LOW | executor-low | verified | docs अपडेट (English) |

---

## 7. Execution groups और मुख्य पल

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

### 1. Migration: up / down / up और probes (G2)
`api/migrations/20261024105906-create-word-prompts-and-responses.cjs` पूरा एक transaction में चलता है। Enum
`enum_word_prompts_status` पहले अलग से बनता है; `down` उल्टे क्रम में `word_responses` → `word_prompts` drop करके enum
हटाता है, और file में WARNING comment है कि `down` सारा data मिटाता है। Test DB पर up → down → up चला, और constraint
probes (जानबूझकर ग़लत inserts) ने अपेक्षित errors दिए (tracking task 3)। `word-models.test.ts` यही नियम दोहराता है:
दूसरा open prompt refuse, दूसरा जवाब refuse, session delete पर cascade।

### 2. बनाए हुए (invented) presenter error codes — पकड़े और ठीक किए (G8)
Presenter का message map ऐसे codes इस्तेमाल कर रहा था जो API कभी भेजता ही नहीं (`WORD_PROMPT_*`)। इन्हें असली codes
से बदला गया: `PROMPT_LIMIT_REACHED`, `PROMPT_NOT_DRAFT`, `SESSION_ENDED`
(`web/src/components/word-cloud/word-messages.ts`)। सबक़: client के error codes हमेशा server के असली codes से मिलाएँ।

### 3. `text` field का path mapping (G6)
Schema `text` को `{ display, key }` में बदलता है, इसलिए Zod issue का path `text.display` आता है। Participant सिर्फ़
`text` field जानता है। हल: route का `validateWordBody` (`word-prompts.routes.ts` line 24–40) field को `text` report
करता है, और controller को **raw** text ही मिलता है (normalise service में होता है, ताकि key हमेशा एक तरह से बने)।
Test: "an empty or over-long word returns 400 with the field named text and no echoed value"। Route में participant
auth (`submitAuth`) body validation से **पहले** चलता है।

### 4. Word-cloud realtime senders (G5, G6)
`createWordCloudEmitters` (`realtime/word-cloud.ts`): per-prompt timer map; `scheduleCloud` 250 ms में burst को एक
update बनाता है; `emitCloudNow` pending timer रद्द करके तुरंत भेजता है; `clearWordCloudTimers` shutdown पर सब रोकता
है। कोई sender throw नहीं करता, और logs में शब्द नहीं — सिर्फ़ ids। Controller का क्रम: start पर पहले बंद हुए prompt
का final cloud और `wordcloud:closed`, फिर `wordcloud:started`; close पर final cloud फिर `wordcloud:closed`; switch
सच में बदलने पर `wordcloud:updated` फिर cloud; submit के बाद `scheduleCloud`। Session end पर भी final cloud और
`wordcloud:closed` (`sessions.controller.ts` line 148–149)।

### 5. End-to-end run
Dev servers पर एक temporary Node script ने असली HTTP और socket clients (presenter + दो participants) से 22 checks
चलाए — सब PASS (नीचे table)। Run के बाद script **हटा दिया गया**।

### Web की बातें (code से)
- `WordCloud.tsx`: शब्द plain React text nodes; पाँच font-size steps (`text-base` से `text-4xl`); `aria-live="polite"`
  सिर्फ़ total पर, ताकि हर शब्द announce न हो; `motion-reduce:transition-none`; ख़ाली होने पर "No words yet. Answers
  will appear here."
- `word-cloud-merge.ts`: बड़ा `version` जीतता है; किसी दूसरे prompt का live cloud अनदेखा।

---

## 8. Verification — इस run में असल में क्या चला

| Check | नतीजा |
|---|---|
| lint | 0 |
| typecheck | 0 |
| unit tests | api 52 + shared 80 + web 110 pass |
| prettier | 0 |
| web build | 0 (सफल) |
| integration (असली Postgres + असली Redis) | **238/238 pass, 39 files** |
| race file | 3 बार clean चला |
| live end-to-end | **22/22 checks pass** |

(ये नंबर इस stage के final run से हैं; यह document लिखते समय commands दोबारा नहीं चलाए गए।)

### Live end-to-end (22 checks, असली run)
HTTP और असली socket clients (presenter + दो participants) दोनों इस्तेमाल हुए। एक temporary Node script ने checks चलाए
और run के बाद उसे हटा दिया गया। Checks ठीक वैसे जैसे print हुए:

| # | Check | नतीजा |
|---|---|---|
| 1 | create session | PASS |
| 2 | create draft prompt (cloud hidden) | PASS |
| 3 | two participants join | PASS |
| 4 | presenter and two participants connected live | PASS |
| 5 | open prompt (200) | PASS |
| 6 | participants get wordcloud:started with no words or counts | PASS |
| 7 | two words accepted (201) | PASS |
| 8 | second word from same participant refused (409) | PASS |
| 9 | empty word refused with field text (400) | PASS |
| 10 | hidden: participant current prompt has cloud null | PASS |
| 11 | hidden: no wordcloud:results reached participants | PASS |
| 12 | hidden: presenter got the cloud (one entry, count 2) | PASS |
| 13 | reveal cloud (200) | PASS |
| 14 | shown: participants get the live cloud | PASS |
| 15 | markup is accepted as plain text, not run (201 or 409 for second word) | PASS |
| 16 | close prompt (200) | PASS |
| 17 | participants receive wordcloud:closed | PASS |
| 18 | word after close refused (409) | PASS |
| 19 | closed prompt keeps the final cloud for the presenter | PASS |
| 20 | no secret or cookie value in any participant message | PASS |
| 21 | end session (200) | PASS |
| 22 | participants receive session:ended | PASS |

**नतीजा: 22 में से 22 PASS।**

**ध्यान दें (check 15):** यह check सिर्फ़ इतना साबित करता है कि request स्वीकार हुई (201, या उसी participant का दूसरा
शब्द होने से 409)। Markup plain text में render होता है — यह **component tests** (`word-cloud-components.test.tsx`)
से जाँचा गया है, इस e2e check से नहीं।

### Tests — कौन सी file क्या साबित करती है

| File | Tests | क्या साबित करता है |
|---|---|---|
| `integration/word-models.test.ts` | 5 | Default show-cloud; दूसरा open prompt और दूसरा जवाब DB refuse करता है; बाद के prompt में जवाब; cascade delete |
| `integration/word-prompts-service.test.ts` | 13 | Draft + empty cloud, ended session, 51वाँ prompt, open पिछले को बंद करता है, दो opens = एक open, close idempotent, close के बाद switch, hidden mapper, top-30 ordering, सबसे आम spelling, empty cloud, अपना शब्द |
| `integration/word-responses-service.test.ts` | 7 | Display रूप में store और key से गिनती; दूसरा शब्द 409; draft 404; closed refuse; ख़ाली/लंबा शब्द; अपना शब्द; अगले prompt में जवाब |
| `integration/word-races.test.ts` | 6 | Identical = 1; दो tabs = 1; दो participants = 2; close के पीछे इंतज़ार करता शब्द refuse; चल रहा शब्द close से पहले पूरा; एक draft दो बार open = एक बार |
| `integration/word-end-closes-prompt.test.ts` | 5 | End खुला prompt बंद करके लौटाता है; बिना prompt कुछ नहीं; दो बार end = कोई बदलाव नहीं; चलता शब्द गिना जाता है; end के बाद refuse |
| `integration/word-prompts-routes.test.ts` | 14 | 201 create, दूसरे session की cookie, open 200, 201 बिना counts, 409 दूसरा शब्द, दूसरे session का participant 401, draft 404, 400 field `text` बिना echo, close के बाद 409, close idempotent, hidden current-prompt + `myWord`, rate limit, question 400, end पर closed prompt announce |
| `integration/wordcloud-races.test.ts` | 4 | दो drafts के दो opens → एक open; close बनाम submit → एक साफ़ नतीजा; end बनाम submit → शब्द गिना, prompt एक बार बंद; एक साथ दो identical submissions = एक शब्द |
| `realtime/wordcloud-live.test.ts` | 7 | Start बिना शब्द/counts; close सबको; hidden cloud सिर्फ़ presenter; shown सबको; burst = एक combined update; दूसरा session कुछ नहीं पाता; failed send throw नहीं |
| `realtime/wordcloud-secrecy.test.ts` | 5 | Hidden में participants को शब्द/counts नहीं; current-prompt और submit response में भी नहीं; reveal पर cloud; फिर hide के commit के बाद कुछ नहीं; किसी message में identity/token/cookie/hash नहीं |

---

## 9. नहीं जाँचा गया (NOT VERIFIED)

1. **असली browser में UI का रूप** — layout, `slate-50` background पर `blue-700` शब्दों का contrast, motion
   (font-size transition); components सिर्फ़ unit tests और build से जाँचे।
2. **असली browser में live updates** — open, cloud बढ़ना, reveal, close दो असली browsers में नहीं देखे।
3. **असली browser में markup rendering** — plain text होना component tests से जाँचा, browser में नहीं देखा।
4. **50 prompts की सीमा** — बिना पूछे लिया default; code comment के अनुसार 49 पर दो एक साथ creates दोनों पास हो सकते
   हैं (soft limit)। **300/min** default production में (असली load, NAT के पीछे कई लोगों वाला IP) नहीं मापा।
5. **e2e markup check की सीमा** — check 15 सिर्फ़ request स्वीकार होना साबित करता है, plain-text rendering नहीं।

---

## 10. Issues और जोखिम

`planning-tracking.md` के "Issues & updates" से:

- **2026-10-24 · MEDIUM (सुलझा) — बनाए हुए presenter error codes:** message map ऐसे codes (`WORD_PROMPT_*`) इस्तेमाल
  करता था जो API नहीं भेजता। असली codes `PROMPT_LIMIT_REACHED`, `PROMPT_NOT_DRAFT`, `SESSION_ENDED` से ठीक किया।
- **2026-10-24 · LOW (सुलझा) — submission validation field:** body schema `text.display` report करता था; route में
  field `text` पर map किया। Test से covered।
- **2026-10-24 · LOW (ज्ञात) — live markup check कमज़ोर:** e2e check markup पर 201 या 409 स्वीकार करता है, इसलिए
  plain-text rendering साबित नहीं करता। Rendering component tests से covered।
- **2026-10-24 · NOT VERIFIED:** word-cloud UI असली browser में (components बने और tested, browser run नहीं)।
- **2026-10-24 · LOW:** 50-prompt cap और 300/min submission limit defaults हैं (दूसरा developer ने चुना)।

Requirement और plan से अतिरिक्त जोखिम:
- **RISK (स्वीकार) — hide race:** cloud छुपाते समय कुछ milliseconds में एक update participants तक जा सकता है; test
  commit के बाद का व्यवहार जाँचता है (polls जैसा)।
- **RISK — अनुचित शब्द:** moderation बाद का feature है; अभी बचाव सिर्फ़ presenter का hide switch।
- **RISK (LOW) — Unicode lookalikes:** दिखने में एक जैसे पर अलग characters दो entries बना सकते हैं; accents रखे जाते हैं
  (ज्ञात सीमा)।
- **RISK — destructive `down`:** migration का `down` सारा prompt और response data मिटाता है; असली data पर approval ज़रूरी।

---

## 11. अगले कदम

1. Commit — **आप** करेंगे (Claude नहीं); Stage 3, 4 और 5 तीनों का code अभी uncommitted है।
2. दो असली browsers में polls और word cloud दोनों का UI और live updates हाथ से देखना (contrast, motion, markup)।
3. अगला stage चुनना — roadmap में अगला **Q&A** (`live-qna`, Phase 7) है, फिर **reactions** (`live-reactions`,
   Phase 8)। आपकी स्पष्ट approval के बिना शुरू नहीं होगा।
