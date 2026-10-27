# Stage 08 — Knowledge base और retrieval (RAG)

> स्रोत (source): `requirements/knowledge-base-rag/requirement.md`, `requirements/knowledge-base-rag/planning-tracking.md`, और असली code
> (`api/src/knowledge/`, `api/src/services/knowledge.service.ts`, `api/src/services/knowledge-search.service.ts`,
> `api/src/ai/tasks/ingest-document.task.ts`, `api/src/routes/knowledge.routes.ts`, `api/src/realtime/knowledge.ts`,
> `web/src/components/knowledge/`)। जहाँ बात इनमें दर्ज नहीं है, वहाँ "(पुष्टि नहीं हुई)" लिखा है।

---

## 1. लक्ष्य — एक लाइन में

Presenter अपनी session के लिए PDF या text file upload करता है; system text निकालकर passages बनाता है, उन्हें meaning और
keyword दोनों से खोजने लायक बनाता है, और हर result के साथ document का नाम और location (page या section) दिखाता है।
यह roadmap का **Phase 10** है (`docs/08-implementation-plan.md`)। इस phase में audience को knowledge base का कुछ नहीं दिखता।

## 2. मुख्य हिस्से

| हिस्सा     | क्या करता है                                                                                                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Upload     | `POST /api/sessions/:id/knowledge/documents`: raw bytes (multipart नहीं) और `X-File-Name` header; हर file 10 MB तक, session में 20 files; सिर्फ़ presenter                                            |
| Type check | Content से: PDF `%PDF-` से शुरू होती है; text strict UTF-8 और NUL byte के बिना; extension (`.pdf` या `.txt`) content से मेल खाना चाहिए                                                                |
| Extraction | PDF (`unpdf`) और text, worker thread में; 256 MB heap, 30 s timeout, 300 pages और 2,000,000 characters की सीमा                                                                                        |
| Ingest job | `INGEST_DOCUMENT` AI job, background runner में; job में सिर्फ़ document id; chunks लगभग 800 characters, 100 overlap; embeddings 32 के batch में (384 dimension)                                      |
| Storage    | `knowledge_documents` (bytes `bytea` में, processing के बाद साफ़) और `knowledge_passages` (`vector(384)` और generated `tsvector`)                                                                     |
| Search     | Vector से top 50 और keyword से top 50, reciprocal rank fusion (k = 60), top 20 reranked, top 8 लौटते हैं; reranker `fake` (default) या `local`; reranker fail हो तो fusion order और `reranked: false` |
| Lifecycle  | Delete में passages भी जाते हैं और रुकी हुई job cancel होती है; session end पर उसके सारे documents हटते हैं                                                                                           |
| Realtime   | `knowledge:document-status` सिर्फ़ presenter room को; payload में न text है, न file name                                                                                                              |

## 3. Verification — इस run में असल में क्या चला

| Check                                                       | नतीजा                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| typecheck (api)                                             | exit 0                                                                 |
| unit tests (api)                                            | 112 pass                                                               |
| integration (api, पूरा)                                     | 62 files, 411 pass, 1 skipped, exit 0 (G4 के बाद, web काम से पहले चला) |
| typecheck (web)                                             | exit 0                                                                 |
| web tests                                                   | 149 pass                                                               |
| knowledge-models                                            | 7/7                                                                    |
| knowledge-search                                            | 5/5                                                                    |
| knowledge-ingest, knowledge-session-end और end-closes files | 26/26 (एक run में)                                                     |
| knowledge-routes                                            | 8/8                                                                    |
| realtime knowledge                                          | 3/3                                                                    |
| live: PDF extraction (`pdf-extract.live.test.ts`)           | **NOT RUN**                                                            |
| live: reranker (`reranker.live.test.ts`)                    | **NOT RUN**                                                            |
| real browser (upload, status बदलना, search)                 | **NOT RUN**                                                            |
| असली upload, चल रहे server पर                               | **NOT RUN**                                                            |

## 4. नहीं जाँचा गया (NOT VERIFIED)

- Live PDF extraction और live reranker इस run में नहीं चले। Local reranker की minimum score `0.5` अभी unverified है;
  उसे live test से तय होना है।
- Real browser में upload, status का "Processing" से "Ready" होना और search नहीं चले।
- चल रहे server पर असली upload (size, type, 21st file) नहीं चला; ये सिर्फ़ tests में जाँचे गए।
- Migrations के `down` और `up` का नतीजा इस record में नहीं लिखा गया (पुष्टि नहीं हुई)। Plan के मुताबिक `down` सिर्फ़ test DB पर और approval के बाद चलना है।
- `unpdf` के लिए Node 22.18 या बाद का version चाहिए; root `package.json` का `engines` अभी `>=20` है। यह open item है, इसे बदला नहीं गया।
- `unpdf` का `npm audit` नतीजा इस record में नहीं है (पुष्टि नहीं हुई)।
- Minimum score हर reranker के लिए constant है, env setting नहीं; upload limit भी constant है (10 MB, हर session में 20 files)।
- Commit नहीं हुआ। Commit आप करेंगे।
