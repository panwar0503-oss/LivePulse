# Stage 09 — AI poll suggestions (ai-poll-generator)

> स्रोत (source): `requirements/ai-poll-generator/requirement.md`, `requirements/ai-poll-generator/planning-tracking.md`, और असली code
> (`api/src/ai/tasks/suggest-polls.*.ts`, `api/src/services/poll-suggestions.service.ts`, `api/src/controllers/poll-suggestions.controller.ts`,
> `api/src/routes/poll-suggestions.routes.ts`, `api/src/realtime/ai.ts`, `shared/src/schemas/poll-suggestions.ts`,
> `web/src/components/polls/PollSuggestions.tsx`, `web/src/hooks/use-poll-suggestions.ts`)। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Presenter अपनी session के knowledge-base documents से poll ideas माँगता है। हर request तीन suggestions लौटाती है; हर suggestion
में question और 2 से 4 options होते हैं, और वह passage भी दिखता है जिससे वह बनी है। Presenter "Use this" दबाकर poll form भरता है,
ज़रूरत हो तो edit करता है, और खुद Create दबाता है। तब तक audience तक कुछ नहीं जाता। यह roadmap का **Phase 11** है
(`docs/08-implementation-plan.md`)।

## 2. मुख्य हिस्से

| हिस्सा     | क्या करता है                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Request    | `POST /api/sessions/:id/poll-suggestions`, body `{}` (strict); `202 { jobId, status, created }`; सिर्फ़ presenter; 6 requests/min per session; AI on और कम से कम एक READY passage ज़रूरी                          |
| Retrieval  | `selectPollSourcePassages`: READY passages में से even sampling, ज़्यादा से ज़्यादा 8; कोई topic query नहीं (free-text topic out of scope)                                                                        |
| Model call | `SUGGEST_POLLS` AI job, background runner में; passages `<passage index="i">` delimiters में; model सिर्फ़ passage index लौटाता है, citation text नहीं; `maxOutputTokens` 800; `promptVersion` `suggest-polls-v1` |
| Validation | Strict schema: 0 से 3 items; question 200 characters तक; 2 से 4 options, हर 80 characters तक; index integer और range में। खराब item गिरा दिया जाता है। JSON ही न बने तो `INVALID_OUTPUT`, और retry नहीं           |
| Dedupe     | एक session में in-flight job, या 30 सेकंड के भीतर बना finished job, वापस आता है; नया job नहीं बनता (`created: false`)                                                                                             |
| Read       | `GET .../poll-suggestions/latest` (DTO या `null`) और `GET .../poll-suggestions/:jobId`; passage text सिर्फ़ इन्हीं responses में; deleted document की suggestion नहीं दिखती                                       |
| Realtime   | `poll-suggestions:ready { sessionId, jobId, status }` सिर्फ़ presenter room को, job के final status पर; payload में कोई text नहीं                                                                                 |
| Web        | Poll tab में `PollSuggestions` panel; "Use this" `CreatePollForm` को `initialValues` से भरता है; Create वही पुराना `onCreate` है; used suggestion सिर्फ़ browser में छिपती है                                     |
| Storage    | Output `ai_jobs.output` में रहता है; कोई नई table या migration नहीं                                                                                                                                               |
| Errors     | 409 `AI_OFF_FOR_SESSION`, `AI_BUDGET_EXHAUSTED`, `SESSION_ENDED`, `NO_RELEVANT_PASSAGES`; 503 `AI_DISABLED`; 429; participant और बिना cookie के 401                                                               |

## 3. Verification — इस run में असल में क्या चला

| Check                                                    | नतीजा                                 |
| -------------------------------------------------------- | ------------------------------------- |
| typecheck (api)                                          | exit 0                                |
| unit tests (api)                                         | 128 pass                              |
| integration (api, पूरा)                                  | 68 files, 444 pass, 1 skipped, exit 0 |
| typecheck (web)                                          | exit 0                                |
| web tests                                                | 161 pass                              |
| web eslint                                               | exit 0                                |
| shared tests                                             | 124 pass                              |
| poll-suggestion routes                                   | 9/9                                   |
| poll-suggestion flow                                     | 5/5                                   |
| realtime poll-suggestions                                | 3/3                                   |
| enqueue-hook (`beforeInsert` regression)                 | 3/3                                   |
| poll-suggestions-service                                 | 9/9                                   |
| असली model का reply (live Claude)                        | **NOT RUN**                           |
| real browser (suggest, panel states, "Use this", Create) | **NOT RUN**                           |
| request से बने job पर realtime path                      | **NOT RUN** (किसी test में नहीं है)   |

## 4. नहीं जाँचा गया (NOT VERIFIED)

- असली model का reply इस run में नहीं आया। Tests में `fake` provider का fixed valid reply चला, और कोई network call नहीं हुई।
- Real browser में "Suggest polls", panel की states, "Use this" और Create नहीं चले।
- Request से बना job पूरा होने पर `poll-suggestions:ready` वाला path किसी test में नहीं है। Realtime test event के room और payload की जाँच करता है, पूरी request-to-event कड़ी की नहीं।
- "15 सेकंड के भीतर suggestions" वाली requirement इस machine पर नापी नहीं गई (पुष्टि नहीं हुई)।
- Prompt injection से बचाव सिर्फ़ unit test में है (delimiters और schema-only parse); असली model के सामने इसकी जाँच नहीं हुई।
- Presenter का "used" suggestion सिर्फ़ browser में छिपता है। Reload के बाद तीनों वापस आते हैं (planning के मुताबिक, server पर छिपाना अभी नहीं है)।
- Commit नहीं हुआ। Commit आप करेंगे।
