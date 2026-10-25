# Stage 07 — AI foundation (AI की नींव)

> स्रोत (source): `requirements/ai-foundation/requirement.md`, `requirements/ai-foundation/planning-tracking.md`, और असली code
> (`api/src/ai/`, `api/src/services/ai-jobs.service.ts`, `api/src/realtime/ai.ts`, `api/src/routes/ai.routes.ts`,
> `api/src/routes/ai-operator.routes.ts`, `api/tests/live/`)। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

AI की नींव बनाना: Claude को background job में चलाने का ढाँचा, एक job queue (PostgreSQL में), session का token budget,
presenter को सिर्फ़ usage और failure दिखाना, और tests के लिए `fake` provider। यह roadmap का **Phase 8–9** है
(`docs/08-implementation-plan.md`)।

## 2. मुख्य हिस्से

| हिस्सा     | क्या करता है                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Provider   | `fake` (tests और demo, बिना network) या `anthropic` (Claude, `@langchain/anthropic`)                                         |
| Embeddings | `fake` या `local` (`@huggingface/transformers`, 384 dimension); model पहली बार download होकर `api/.cache/models` में रहता है |
| Job queue  | `ai_jobs` table; enqueue में dedupe; claim एक ही runner को मिलता है                                                          |
| Runner     | Background में चलता है, request या transaction के अंदर नहीं; retry, restart पर recovery                                      |
| Budget     | Reserve, फिर settle: session लॉक के अंदर estimate reserve, फिर असली tokens                                                   |
| Switch     | Session का AI on/off; global switch (एक process के अंदर); operator route `PATCH /api/ops/ai` (header key)                    |
| Realtime   | `ai:status`, `ai:usage`, `ai:job-failed` सिर्फ़ presenter room को                                                            |

## 3. Verification — इस run में असल में क्या चला

| Check                                           | नतीजा                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| typecheck (api)                                 | exit 0                                                                                                             |
| typecheck (web)                                 | exit 0                                                                                                             |
| lint (`npx eslint api`)                         | exit 0                                                                                                             |
| unit tests (`npm test -w api`)                  | 79 pass                                                                                                            |
| integration (`npm run test:integration -w api`) | 365 pass, 1 skipped (coordinator-reported; इस agent run में `TEST_DATABASE_URL` न होने से exit 1, फिर से नहीं चला) |
| web tests                                       | 141 pass (coordinator-reported)                                                                                    |
| prettier (changed files)                        | 6 docs में warnings; HEAD पर भी 4 docs fail थे (पुष्टि नहीं हुई कि बाक़ी किसने जोड़ा)                              |
| live: Anthropic smoke                           | **NOT RUN** (key और network नहीं इस्तेमाल हुए)                                                                     |
| live: local embeddings                          | **NOT RUN** (model download नहीं हुआ)                                                                              |

Live tests `api/tests/live/` में हैं और `npm run test:live -w api` से चलते हैं। वे default runs में शामिल नहीं हैं।

## 4. नहीं जाँचा गया (NOT VERIFIED)

- Live Anthropic request और live local embeddings: इस session में नहीं चले।
- Migrations के down/up का नतीजा इस record में नहीं लिखा गया (पुष्टि नहीं हुई)।
- Commit नहीं हुआ। Commit आप करेंगे।
