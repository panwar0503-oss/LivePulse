# Stage 11 — Post-session report और "Ask your session" (ai-session-report)

> स्रोत (source): `requirements/ai-session-report/requirement.md`, `requirements/ai-session-report/planning-tracking.md`, और असली code (report और chat से जुड़ी api और web फ़ाइलें)। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Session खत्म होने के बाद (या चलते समय भी) presenter एक report देख और export कर सकता है, जिसमें सिर्फ़ session के तथ्य हैं: polls, word cloud, questions, documents और AI usage। "Ask your session" chat उसी session के data पर fixed read-only tools से जवाब देती है, जवाब stream होता है, और हर जवाब अपने sources दिखाता है। यह roadmap का **Phase 14** है (`docs/08-implementation-plan.md`, `docs/10-ai-architecture.md` section 5.5)। Phase 12 (copilot) और 13 (insights) अभी नहीं बने हैं, इसलिए report में उनके sections नहीं हैं।

## 2. मुख्य हिस्से

| हिस्सा     | क्या करता है                                                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report     | `GET .../report`: poll results, top word-cloud terms, question counts, top-upvoted questions, knowledge documents, AI usage। कोई table नहीं; हर read पर session के data से गणना, एक read-only transaction में |
| Export     | `GET .../report/export`: वही DTO JSON attachment के रूप में                                                                                                                                                   |
| Chat       | `POST .../report/chat` (`clientMessageId`, `question` 1–500 characters): हर सवाल पर session का DTO snapshot; सिर्फ़ fixed read-only tools                                                                     |
| Stream     | जवाब SSE के रूप में उसी POST response पर: `start`, `delta`, `tool`, `done`, `error`। किसी socket room में कुछ नहीं जाता                                                                                       |
| Sources    | Server तय करता है: tool results के server references को labels मिलते हैं; model के लिखे citations नहीं माने जाते                                                                                              |
| Budget     | हर सवाल एक `ai_jobs` row (type `SESSION_REPORT`, `max_attempts = 1`, `reserved_tokens = 8000`) से reserve होता है; settle पर असली tokens लिखे जाते हैं और `ai:usage` presenter room को जाता है                |
| Incomplete | Fail, abort, timeout (45 सेकंड), cap या round limit पर जवाब `INCOMPLETE` होता है और partial text रहता है                                                                                                      |
| Documents  | Session खत्म होने पर documents हट जाते हैं; report में उनके नाम नहीं, सिर्फ़ सफल ingest की गिनती दिखती है                                                                                                     |
| Storage    | `session_chat_turns` (session delete पर cascade; `client_message_id` हर session में unique)                                                                                                                   |
| After end  | AI चालू था तो session खत्म होने के बाद भी chat उपलब्ध; AI बंद था तो chat नहीं (AI session खत्म होने के बाद चालू नहीं हो सकता)                                                                                 |
| Errors     | JSON में पहले से refuse: 400, 401, 403 `FORBIDDEN_ORIGIN`, 404, 409 `AI_OFF_FOR_SESSION` / `AI_BUDGET_EXHAUSTED` / `CHAT_BUSY` / `DUPLICATE_MESSAGE`, 429, 503 `AI_DISABLED`                                  |
| Realtime   | कोई नया event नहीं; participants को report या chat से कुछ नहीं मिलता                                                                                                                                          |

## 3. Verification — इस run में असल में क्या चला

| Check                                              | नतीजा       |
| -------------------------------------------------- | ----------- |
| typecheck (api)                                    | exit 0      |
| unit tests (api)                                   | 157 pass    |
| unit tests (shared)                                | 135 pass    |
| web tests                                          | 187 pass    |
| web lint                                           | exit 0      |
| report integration                                 | 11/11       |
| chat service integration                           | 11/11       |
| chat stream, report और chat files एक साथ           | 33/33       |
| session-chat-turns model                           | 4/4         |
| असली model के जवाब                                 | **NOT RUN** |
| real browser में SSE stream                        | **NOT RUN** |
| real proxy (buffering) के पीछे SSE                 | **NOT RUN** |
| full integration suite (coordinator अलग से चलाएगा) | **NOT RUN** |

## 4. नहीं जाँचा गया (NOT VERIFIED)

- असली model का जवाब इस run में नहीं आया। Tests में `fake` provider चला, और कोई network call नहीं हुई। जवाबों की गुणवत्ता और sources का चुनाव असली model पर नहीं नापे गए।
- Real browser में SSE stream नहीं चला; partial answer का दिखना और दोबारा पूछने का रास्ता browser में नहीं देखा गया।
- Proxy के पीछे (buffering, helmet) SSE नहीं जाँचा गया।
- Full integration suite इस stage के लिए नहीं चला; coordinator अलग से चलाएगा।
- Commit नहीं हुआ। Commit आप करेंगे।
