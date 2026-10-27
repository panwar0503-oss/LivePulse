# Stage 10 — AI Q&A copilot (ai-qna-copilot)

> स्रोत (source): `requirements/ai-qna-copilot/requirement.md`, `requirements/ai-qna-copilot/planning-tracking.md`, और असली code
> (`api/src/ai/tasks/qna-copilot/`, `api/src/ai/tasks/qna-copilot.constants.ts`, `api/src/services/qna-copilot.service.ts`,
> `api/src/controllers/qna-copilot.controller.ts`, `api/src/routes/qna-copilot.routes.ts`, `api/src/realtime/qna-copilot.ts`,
> `shared/src/schemas/qna-copilot.ts`, `web/src/components/qna/CopilotReview.tsx`, `web/src/components/qna/ClustersPanel.tsx`,
> `web/src/hooks/use-qna-copilot.ts`)। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

हर audience question को AI से जाँचा जाता है: safety (moderation), पहले से पूछे गए सवाल से मिलान (duplicate), और presenter की
knowledge base से citations वाला draft जवाब। Draft तभी presenter तक पहुँचता है जब उसका self-check पास हो। Presenter draft
देखकर edit करके approve करता है, और तभी approved text room को दिखता है। यह roadmap का **Phase 12** है
(`docs/08-implementation-plan.md`, `docs/10-ai-architecture.md` section 5.3)।

## 2. मुख्य हिस्से

| हिस्सा     | क्या करता है                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Job        | हर question पर एक `QNA_COPILOT` job; graph के हर node का result और `questions.ai_step` अपनी छोटी transaction में commit होता है। Table ही checkpoint है, LangGraph checkpointer नहीं                                                        |
| Moderation | `moderate` node: label `OK / TOXIC / SPAM / OFF_TOPIC / PII`, भाषा, और English query लौटाता है। OK न हो तो question HELD होता है और room को नहीं दिखता                                                                                      |
| Dedupe     | English query का local embedding; `QNA_DUPLICATE_SIMILARITY` (0.90) से ऊपर → MERGED, asker का upvote canonical question पर जाता है। नीचे → VISIBLE और nearest cluster में (`QNA_CLUSTER_SIMILARITY`, 0.75)                                  |
| Draft      | सिर्फ़ READY passages से; citations ज़्यादा से ज़्यादा 3; 500 characters, एक line, plain text। Passage न हो तो "Not covered in the materials" बिना model call के                                                                            |
| Self-check | अलग provider call; हर claim cited passages से जाँचा जाता है। Parse न हो तो "not supported"। Draft तब तक DRAFTING रहता है जब तक self-check पास न हो; उसके बाद PENDING_REVIEW                                                                 |
| Presenter  | `GET .../qna/review` (held questions और drafts); approve (optional edited `text`), reject draft; release या reject held question; `GET .../qna/clusters`                                                                                    |
| Realtime   | Presenter room: `qna:review-updated { sessionId, questionId, draftId, state }`, `qna:clusters-updated { sessionId }`। Room: `question:created` (release या VISIBLE होने पर), `question:updated` (approve पर), `question:upvotes` (merge पर) |
| Storage    | `questions` में review state, label, duplicate link, embedding, `ai_step`, cluster id, answer source, citations; नई tables `question_clusters` और `ai_answer_drafts`; 3 migrations (up और down)                                             |
| Rate limit | चारों mutation routes पर 60 प्रति मिनट प्रति session (`qna-copilot:<sessionId>`); 429 `RATE_LIMITED`                                                                                                                                        |
| Fail-open  | AI off, budget खत्म, या AI न चल पाए तो question तुरंत VISIBLE; job गिरने पर question released। यह निर्णय developer ने लिया है (पुष्टि: planning-tracking, 2026-10-25)                                                                       |
| Errors     | 409 `DRAFT_NOT_PENDING`, `QUESTION_NOT_VISIBLE`, `QUESTION_ALREADY_ANSWERED`, `QUESTION_NOT_HELD`; 404 `NOT_FOUND`; 400 `VALIDATION_ERROR`; 401 `PRESENTER_AUTH_REQUIRED`; 403 `FORBIDDEN_ORIGIN`                                           |

## 3. Verification — इस run में असल में क्या चला

| Check                                                                  | नतीजा                                |
| ---------------------------------------------------------------------- | ------------------------------------ |
| typecheck (api)                                                        | exit 0                               |
| unit tests (api)                                                       | 141 pass                             |
| unit tests (shared)                                                    | 130 pass                             |
| web tests                                                              | 169 pass                             |
| web eslint                                                             | exit 0                               |
| copilot integration: nodes                                             | 8/8                                  |
| copilot integration: graph                                             | 7/7                                  |
| copilot integration: service                                           | 10/10                                |
| copilot integration: routes                                            | 10/10                                |
| copilot integration: session end                                       | 5 pass (same run में पहले के 6 और 6) |
| copilot integration: visibility                                        | 8/8                                  |
| copilot integration: models                                            | 6/6                                  |
| realtime copilot events                                                | 8/8                                  |
| realtime qna-live और qna-secrecy                                       | 13/13                                |
| existing questions और Q&A integration files                            | 55/55                                |
| असली model का reply (live Claude)                                      | **NOT RUN**                          |
| live browser (review panel, clusters, approve, release)                | **NOT RUN**                          |
| full integration suite (coordinator अलग से चलाएगा)                     | **NOT RUN**                          |
| fail-open release का realtime event (`question:created` after give-up) | **NOT RUN** (किसी test में नहीं है)  |

## 4. नहीं जाँचा गया (NOT VERIFIED)

- असली model का reply इस run में नहीं आया। Tests में `fake` provider चला, और कोई network call नहीं हुई। Moderation की
  accuracy, grounding की गुणवत्ता और non-English answers असली model पर नापे नहीं गए।
- Real browser में review panel, clusters, approve, edit और release नहीं चले।
- Full integration suite इस stage के लिए नहीं चला; coordinator अलग से चलाएगा।
- Fail-open के बाद released question का `question:created` event किसी test में नहीं है।
- Presenter का approve करना और room में edited text का दिखना सिर्फ़ service और realtime tests से पक्का है, पूरी browser कड़ी से नहीं।
- Clusters के लिए label सिर्फ़ सबसे पहले question का text है; LLM label नहीं बना (planning के मुताबिक)।
- Commit नहीं हुआ। Commit आप करेंगे।
