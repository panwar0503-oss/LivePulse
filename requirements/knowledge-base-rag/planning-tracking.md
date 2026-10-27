# knowledge-base-rag — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Knowledge base and retrieval

### Architecture
| Component | Location | Notes |
|---|---|---|
| Upload endpoint | `POST /api/sessions/:id/knowledge/documents` | No new parser. `express.raw({ limit: '10mb' })` on this route only; 413 from Content-Length before buffering. File name in `X-File-Name`, Zod-checked. Presenter auth and rate limit run before the body is read. |
| Type sniffing | `api/src/knowledge/file-type.ts` | PDF: starts with `%PDF-`. Text: strict UTF-8 decode, no NUL bytes. Extension must match. |
| PDF extraction | `api/src/knowledge/extractors/` | Worker thread with 256 MB heap, 30 s timeout (terminate), 300-page and 2M-character caps. Library: **`unpdf`** recommended (or `pdf-parse@2`); not `pdf-parse@1`. **Needs approval after `npm audit`.** Fake extractor in tests. |
| Chunker | `api/src/knowledge/chunker.ts` | ~800 characters, 100 overlap, paragraph/sentence boundaries; a passage never spans two pages; PDF location = page, text location = section number; max 2,000 passages per document. |
| Ingest task | `api/src/ai/tasks/ingest-document.task.ts` | Task `INGEST_DOCUMENT` through the existing runner; reserve 0 tokens; embeds in batches of 32 (384 dims). |
| Storage | `knowledge_documents`, `knowledge_passages` | Original bytes in `bytea`, cleared after processing. `vector(384)` plus generated `tsvector`. |
| Hybrid search | `api/src/services/knowledge-search.service.ts` | Top 50 by cosine distance + top 50 full-text rank, session-filtered; reciprocal rank fusion (k=60); top 20 reranked; top 8 returned; scores below threshold dropped. |
| Reranker | `api/src/knowledge/reranker/` | Interface with fake (token overlap) and local (`Xenova/ms-marco-MiniLM-L-6-v2`, ~23 MB quantized) via existing `@huggingface/transformers`. Falls back to fusion order with `reranked:false`. Env `RERANKER_PROVIDER` (default fake), `RERANKER_MODEL`. |
| Knowledge page | `web/src/app/presenter/[sessionId]/knowledge/page.tsx` | Upload, list, search, remove; linked from the presenter page. |

### Key decisions
1. Raw body instead of multipart: no new dependency, size cap before parsing.
2. File bytes live in Postgres `bytea`; job input is only `{ documentId }`.
3. Exact vector scan per session, no ANN index (max 40k passages per session); HNSW can be revisited.
4. Runner-level failures show as FAILED with `PROCESSING_STOPPED`, derived from the linked job; no runner hooks for this.
5. Upload count check uses `pg_advisory_xact_lock` after a session SHARE lock, so polls and votes are not blocked.

### Contracts
**HTTP** (presenter cookie, origin check on every route; 404 for a missing or someone else's session):
| Route | Body | 2xx | Errors |
|---|---|---|---|
| POST /api/sessions/:id/knowledge/documents | raw bytes + `X-File-Name` | 201 KnowledgeDocument | 400 INVALID_FILE_NAME / EMPTY_FILE; 409 DUPLICATE_DOCUMENT / DOCUMENT_LIMIT_REACHED / SESSION_ENDED / AI_OFF_FOR_SESSION; 413 FILE_TOO_LARGE; 415 UNSUPPORTED_FILE_TYPE; 429; 503 AI_DISABLED |
| GET /api/sessions/:id/knowledge/documents | – | 200 `{ documents }` (max 20) | 401, 404 |
| DELETE /api/sessions/:id/knowledge/documents/:docId | – | 204 | 404 |
| POST /api/sessions/:id/knowledge/search | `{ query: 1–500 chars }` (30/min) | 200 `{ results, reranked }` | 400, 404, 503 KNOWLEDGE_UNAVAILABLE |

**Socket** (presenter room only, after commit): `knowledge:document-status { documentId, status, failureReason|null }`. No text, no file names.

**Shared Zod** (`shared/src/schemas/knowledge.ts`): document, status, failure reason enum (NO_TEXT, UNREADABLE, TOO_MANY_PAGES, TOO_LARGE_TEXT, TIMEOUT, PROCESSING_STOPPED), search body, result, file name, `KNOWLEDGE_LIMITS`.

### Database (two generated migrations)
1. `create-knowledge-documents`: id, session_id FK CASCADE, ai_job_id FK SET NULL, file_name varchar(200), mime_type, size_bytes, content_hash char(64), content bytea NULL, status enum (PROCESSING, READY, FAILED), failure_reason NULL, page_count, passage_count, timestamps. UNIQUE(session_id, content_hash); CHECKs on size (1 … 10,485,760), mime type, FAILED requires reason. Index (session_id, created_at).
2. `create-knowledge-passages`: id, document_id FK CASCADE, session_id FK CASCADE, ordinal, page_number NULL, section_number NULL, content text, embedding vector(384), tsv generated tsvector STORED. CHECKs: exactly one of page/section set; content 1–4000 characters. Indexes: session_id, (document_id, ordinal), GIN(tsv).
- **Both `down` migrations are destructive** (drop tables and enum). Test DB only until approved.

### Concurrency
- Upload: session SHARE → advisory lock → status and AI checks → count < 20 → hash dedupe → insert document → insert job (dedupe key `ingest:<docId>`) → commit → nudge. Unique constraint is the final dedupe guard (maps to 409).
- Ingest commit: extraction and embedding run outside any transaction. Then session SHARE → document FOR UPDATE; if missing, not PROCESSING, or session ended, discard everything. Otherwise insert passages, set READY, clear bytes, commit, emit.
- Delete: session SHARE → advisory lock → document FOR UPDATE → delete (passages cascade) → cancel the pending job.
- Session end: `endSession` deletes its documents inside its existing FOR UPDATE transaction.

### Security
- Order: authorization → Content-Length limit → file name → magic bytes → UTF-8 check. Nothing is parsed before these.
- Extraction only in the worker, with caps.
- DTOs only; `content` and `content_hash` never returned; logs carry ids, sizes, codes only.
- Retrieved text is rendered as plain text. No action is taken from document text. Phase 12 must wrap it in delimited, untrusted blocks.

### Testing
- Unit: chunker boundaries and caps; sniffing (renamed PNG refused, PDF named `.txt` refused, invalid UTF-8); RRF ordering and ties; threshold; limits; fake reranker.
- Integration (fake extractor, embeddings, reranker): upload → run → READY → ranked results with citations; 413, 415, 409; 21st file refused with nothing stored; empty search; delete removes results at once; delete during processing; session end purges; other presenter and participant refused; concurrent 20th/21st upload race; `down`/`up` on test DB.
- Realtime: status reaches presenter room only; no text in payload.
- Web: pure tests for list merge and status labels.
- Live (`AI_LIVE_TEST`): real PDF library on a fixture; real reranker orders a relevant passage first.

### Tasks (v1)
| # | Task | Cx | Executor | Deps | Files |
|---|---|---|---|---|---|
| 1 | Knowledge Zod schemas, limits, event | LOW | executor-low | — | shared/src/schemas/knowledge.ts (+test), shared/src/index.ts, shared/src/events/realtime.ts |
| 2 | Two migrations (CLI-generated) | HIGH | executor-high | 1 | api/migrations/*-create-knowledge-{documents,passages}.cjs |
| 3 | Models and associations | MEDIUM | executor-medium | 2 | api/src/models/knowledge-{document,passage}.model.ts, models/index.ts, tests/integration/knowledge-models.test.ts, tests/helpers/truncate.ts |
| 4 | File-type sniffing and chunker | MEDIUM | executor-medium | 1 | api/src/knowledge/{file-type,chunker}.ts (+tests) |
| 5 | Extractor interface, fake, text, PDF worker (after approval) | HIGH | executor-high | 4 | api/src/knowledge/extractors/* |
| 6 | Reranker interface, fake, local, env vars | MEDIUM | executor-medium | — | api/src/knowledge/reranker/*, api/src/config/env.ts, .env.example |
| 7 | Transaction-scoped job insert; runner task deps and per-task timeout | HIGH | executor-high | — | ai-jobs.service.ts, ai/runner.ts, ai/tasks/registry.ts, ai/startup.ts |
| 8 | Knowledge service: upload, list, delete with locks | HIGH | executor-high | 3, 4, 7 | api/src/services/knowledge.service.ts (+integration test) |
| 9 | Ingest task and emit after commit | HIGH | executor-high | 5, 7, 8 | ai/tasks/ingest-document.task.ts (+integration test) |
| 10 | Hybrid search and RRF | MEDIUM | executor-medium | 3, 6 | api/src/services/knowledge-search.service.ts (+tests) |
| 11 | Purge on session end | MEDIUM | executor-medium | 8 | services/sessions.service.ts (+integration test) |
| 12 | Routes and controller (auth before raw body, rate limits) | HIGH | executor-high | 8, 10 | routes/knowledge.routes.ts, controllers/knowledge.controller.ts, app.ts (+route test) |
| 13 | Presenter-only status emit | MEDIUM | executor-medium | 9 | realtime/knowledge.ts, realtime/index.ts (+realtime test) |
| 14 | API client, hook, merge | MEDIUM | executor-medium | 1, 12 | web/src/lib/api/knowledge.ts, hooks/use-knowledge.ts, knowledge-merge.ts (+test) |
| 15 | Knowledge page, components, link | MEDIUM | executor-medium | 14 | web/src/app/presenter/[sessionId]/knowledge/page.tsx, components/knowledge/*, presenter page |
| 16 | Live tests | LOW | executor-low | 5, 6 | api/tests/live/{pdf-extract,reranker}.live.test.ts, fixture PDF |

Groups: G1 (1–3) → G2 (4–6) → G3 (7–11) → G4 (12–13) → G5 (14–16). Each group verified with its targeted commands and real exit codes.

### Progress
- G1 (tasks 1–3) done 2026-10-25: shared 119/119; api typecheck 0; api unit 79; knowledge-models 7/7; migrations 10 up on test DB.
- G2 (tasks 4–6) done 2026-10-25: unit 107/107; typecheck 0; `unpdf@1.8.1` exact (released 2026-08-13, two newer releases too recent). Open: root `engines` says Node >= 20 but unpdf needs Node >= 22.18.
- G3 (tasks 7–11) done 2026-10-25: runner refactor and knowledge service (14/14), ingest task and session purge (26 across five files), hybrid search (5/5). Full API integration run alone: 62 files, 411 passed, 1 skipped, exit 0.
- G4 (tasks 12–13) done 2026-10-25: routes (8/8), presenter-only status events (3/3), server wiring with by-type extractor; unit 112/112.
- G5 (tasks 14–16) done 2026-10-25: web typecheck 0, web tests 149/149, lint and prettier 0; live tests added (`npm run test:live -w api`), not run.
- Docs done 2026-10-25: architecture, API contract, realtime events, test plan, setup (dead env keys removed), Hindi stage-08.
- Requirement stays `in_progress` until the live checks run: real PDF extraction, the local reranker and its 0.5 score cutoff (unverified), and a real upload through the running server and browser.

### Approvals needed
1. PDF library: `unpdf` (or `pdf-parse@2`), exact pin, after `npm audit` review.
2. Reranker model download: `Xenova/ms-marco-MiniLM-L-6-v2`, ~23 MB, one time, used by live tests and local mode only.
3. Destructive `down` for both migrations: test DB only.
4. New authenticated upload route accepting 10 MB of untrusted bytes.
5. Refactor of the shared runner and `ai-jobs.service` (task dependencies, per-task timeout, transaction-scoped insert). Existing AI tests must stay green.
6. `endSession` change: also deletes knowledge data (high-risk shared path).

### Risks
| Level | Risk | Mitigation |
|---|---|---|
| HIGH | Malicious PDF exhausts CPU or memory | Worker with heap limit, terminate on timeout, page and character caps, 10 MB cap before reading |
| HIGH | Runner refactor breaks existing AI jobs | Existing runner tests stay green; changes additive and optional |
| HIGH | Prompt injection through documents | Text is data; no LLM in this phase; delimited context required in Phase 12 |
| MEDIUM | 10 MB bytea insert slows the database | Advisory lock, not session FOR UPDATE; bytes cleared after processing |
| MEDIUM | 2,000 passages miss the 60 s target | Batching, passage cap, 120 s per-task timeout |
| MEDIUM | PDF library vulnerabilities | Approval, audit, isolated worker |
| LOW | Fusion or rerank threshold poorly tuned | Constant threshold; live test checks it |

### Open questions (decide before approval)
1. PDF library: `unpdf` (recommended) or `pdf-parse@2`?
2. Upload requires the session's AI to be on (otherwise the runner skips the job). Plan says yes. Search does not require it. Confirm?
3. Should `.md` count as plain text, or only `.txt`? Plan assumes `.txt` only.

## Approval
- Plan v1 approved by the developer on 2026-10-25 with the recommended answers: `unpdf` (exact pin), reranker `Xenova/ms-marco-MiniLM-L-6-v2` (live and local mode only), destructive `down` on the test DB only, upload route, runner refactor, `endSession` change. AI required for upload, search does not require AI, `.txt` only (no `.md`). Execution started.

## Approvals needed
- See "Approvals needed" above (items 1–6).

## Decisions
<!-- Filled after the developer answers the open questions and approves. -->

## Issues & updates
<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-25 | plan_created | Plan v1 drafted by planner; six approvals listed; three open questions; awaiting approval | planning-tracking.md |
