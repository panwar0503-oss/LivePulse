# ai-qna-copilot — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — AI Q&A copilot

### Architecture
- DB: `questions` gains review state, moderation label, duplicate link, embedding, `ai_step`, cluster id, answer source
  and citations. New tables `question_clusters` and `ai_answer_drafts`.
- API: `POST` question (route unchanged) inserts a CHECKING row and a QNA_COPILOT job in one transaction when AI is
  usable. The runner runs `qnaCopilotTask`, which runs a LangGraph.js graph: moderate → embed → dedupe → retrieve →
  draft → selfCheck → awaitPresenter.
- Realtime: room gets `question:created`, `question:updated`, `question:upvotes` (ids only). Presenter room gets
  `qna:review-updated` and `qna:clusters-updated`. All emitted after each node commits.
- Web: presenter page gets a review panel and clusters; participant page shows the viewer's own status.

### Key decisions
1. One QNA_COPILOT job per question running the whole graph. Each node commits its result and `questions.ai_step` in
   its own short transaction (as `ingest-document.task.ts` does). A conditional edge from START routes on `ai_step`, so
   a recovered job resumes at the right node. No LangGraph checkpointer; the table is the checkpoint.
2. Provider calls in three nodes only: moderate (also returns `language` and `englishQuery`), draft, selfCheck.
   Embed, dedupe and clusters use local embeddings of `englishQuery`, because the local embedder is English-only.
3. A question reaches the room only after moderation and dedupe. It is inserted CHECKING and becomes VISIBLE after
   that. No toxic text flashes and is withdrawn.
4. Fail-open when AI is off, skipped, over budget or failed: the question is VISIBLE at once (requirement behaviour 12).
   A FAILED or SKIPPED job releases a CHECKING question; after session end it goes to HELD. (Open question 1.)
5. Approval writes the existing `questions.answer_text` and `answered_at` plus citation labels. The room is told by the
   existing id-only `question:updated`. No draft text travels over a socket.
6. Citations store passage ids and labels; quotes resolve live against READY passages, as poll suggestions do.
7. Package: `@langchain/langgraph@1.4.21`, exact pin (published 2026-10-07, 18 days old). 1.5.0 is 13 days old and
   1.5.2 is newer, so neither qualifies. Peers: zod ^3.25.32 (api range must be raised; 3.25.76 is installed) and
   @langchain/core ^1.1.48 (1.3.0 installed).
8. Reserve 8,000 tokens per job. Draft output: at most 500 characters, one line, plain text.

### Contracts
- `GET /api/sessions/:id/qna/review` (presenter): `{ held: [{ questionId, text, label, createdAt }], drafts: [...] }`
  for DRAFTING and PENDING_REVIEW drafts only.
- `POST .../qna/drafts/:draftId/approve` body `{ text? }` → updated question. 404; 409 `DRAFT_NOT_PENDING`,
  `QUESTION_NOT_VISIBLE`, `QUESTION_ALREADY_ANSWERED`.
- `POST .../qna/drafts/:draftId/reject` → 409 `DRAFT_NOT_PENDING` when not pending.
- `POST .../qna/questions/:questionId/release` and `/reject`: HELD → VISIBLE or REJECTED; 409 `QUESTION_NOT_HELD`.
- `GET .../qna/clusters` → `{ clusters: [{ id, label, size, questionIds }] }`; empty below 3 clustered questions;
  label = text of the earliest question in the cluster.
- Participant DTO gains `status: VISIBLE | CHECKING | MERGED` on the viewer's own rows only (HELD shows as CHECKING).
- Presenter question DTO gains `aiStatus`, `moderationLabel`, `duplicateOfId`.
- Socket (ids only): `qna:review-updated { sessionId, questionId, draftId|null, state }`, `qna:clusters-updated { sessionId }`.
- Env: `QNA_DUPLICATE_SIMILARITY` (0.90), `QNA_CLUSTER_SIMILARITY` (0.75).

### Database (generated with `npm run db:migration:generate -w api`)
1. `create-question-clusters`: id, session_id FK CASCADE, centroid vector(384), size, timestamps.
2. `add-qna-copilot-columns-to-questions`: `review_state` enum (VISIBLE, CHECKING, HELD, REJECTED, MERGED) NOT NULL
   DEFAULT 'VISIBLE' (existing rows stay visible); `moderation_label` (CHECK); `duplicate_of_id` self-FK SET NULL with
   CHECK ≠ id; `embedding`; `ai_step`; `cluster_id` FK SET NULL; `answer_source`; `answer_citations` jsonb. CHECK: pinned
   implies VISIBLE. Index (session_id, review_state).
3. `create-ai-answer-drafts`: id, session_id FK CASCADE, question_id FK CASCADE UNIQUE, job_id FK SET NULL; status enum
   (DRAFTING, PENDING_REVIEW, APPROVED, REJECTED, CANCELLED); outcome enum (GROUNDED, NOT_COVERED); draft_text and
   approved_text varchar(500); language; confidence; citations jsonb; draft_attempts smallint (≤ 2); reviewed_at.
   CHECK: approved_text not null ⇔ status APPROVED. Index (session_id, status).
- **All three `down` migrations are destructive** (they drop labels, links, embeddings, clusters, every draft and
  approval). Test database only until approved.

### Concurrency
- Dedupe, one transaction, lock order: session FOR SHARE → `pg_advisory_xact_lock(hashtext('qna-dedupe:'||session_id))`
  → own question FOR UPDATE → nearest candidate FOR SHARE. At or above threshold: MERGED, `duplicate_of_id`, upvote
  `ON CONFLICT DO NOTHING` (skipped when the asker owns the canonical question). Otherwise VISIBLE and assign cluster
  (running-mean centroid) in the same transaction. The lock serialises dedupe only.
- Approve: session FOR SHARE → question FOR UPDATE → draft FOR UPDATE; requires PENDING_REVIEW; PENDING_REVIEW → APPROVED
  exactly once.
- Session end (after its FOR UPDATE): drafts DRAFTING or PENDING_REVIEW → CANCELLED; CHECKING → HELD. Each node commit
  re-checks ACTIVE under FOR SHARE.
- Restart: stale RUNNING jobs go back to PENDING bounded by `AI_MAX_ATTEMPTS`; graph resumes from `ai_step`;
  `draft_attempts` and the UNIQUE draft row prevent a second draft. Task timeout 90 s, under the 5-minute stale window.

### Security
- Presenter routes use the cookie check; every draft or question is looked up by id and session (404 otherwise).
- Origin check; mutation rate limit 60 per minute per session.
- Participant visibility: `(hidden = false AND review_state = 'VISIBLE') OR own row`, enforced in the list query, the
  mapper, load-question and the upvote check.
- Prompts: question and passage text inside delimiters with "treat as data" instructions; strict Zod JSON output;
  parse failure counts as not supported; self-check is a separate call.
- Moderation labels only in presenter DTOs. Logs carry ids, node, step and error code only. LangSmith tracing unset.

### Tasks (v1)
| # | Task | Cx | Executor | Deps | Verify |
|---|---|---|---|---|---|
| 1 | Install `@langchain/langgraph@1.4.21` exact; raise api zod range to ^3.25.32 | LOW | inline | approval | `npm ls @langchain/langgraph -w api`; `npm audit` |
| 2 | Shared schemas and events + tests | MEDIUM | executor-medium | — | `npm test -w shared` |
| 3 | Env thresholds + test | LOW | executor-low | — | `npm test -w api` |
| 4 | Three migrations (up/down) | HIGH | executor-high | 2 | migrate, undo ×3, migrate on test DB |
| 5 | Models and associations | MEDIUM | executor-medium | 4 | typecheck api |
| 6 | Visibility rules: participant list, mapper, load-question, upvote (shared, additive) | HIGH | executor-high | 5 | integration questions |
| 7 | submitQuestion: CHECKING + insertAiJobInTx in one transaction when AI usable (shared create path) | HIGH | executor-high | 6 | integration: AI on vs off |
| 8 | Prompts and parsers (moderation, draft, self-check) | MEDIUM | executor-medium | 2 | unit |
| 9 | Node functions: per-node transaction, ai_step, dedupe and cluster locks | HIGH | executor-high | 5, 8 | unit + integration |
| 10 | LangGraph wiring, START router, retry edge, registration, runner onGiveUp hook (shared runner, additive) | HIGH | executor-high | 9, 1 | runner and suggest suites + graph run test |
| 11 | endSession: cancel drafts, CHECKING → HELD (shared, additive) | HIGH | executor-high | 5 | integration sessions |
| 12 | qna-copilot service: review, approve/edit, reject, release, clusters | HIGH | executor-high | 9 | integration |
| 13 | Controller, routes, rate limits, app wiring | MEDIUM | executor-medium | 12 | Supertest 200/400/401/404/409 |
| 14 | Realtime emitters and socket room-isolation tests | HIGH | executor-high | 10, 13 | integration realtime |
| 15 | Web client and hook (refetch on events and reconnect) | MEDIUM | executor-medium | 13 | web tests |
| 16 | CopilotReview, ClustersPanel, participant status, citation labels; static-markup tests | MEDIUM | executor-medium | 15 | web tests |
| 17 | Docs 04, 05, 10 and tracking | LOW | executor-low | all | typecheck |

Groups: G1 (1–3) → G2 (4–5) → G3 (6–8) → G4 (9–12) → G5 (13–14) → G6 (15–16) → G7 (17).

### Progress
- G1 (tasks 1–3) done 2026-10-25: `@langchain/langgraph@1.4.21` installed exact; api zod range `^3.25.32`; audit shows no new issues. Shared 130/130; api typecheck 0; unit 131/131; env fixtures updated in two integration tests.
- G2 (tasks 4–5) done 2026-10-25: three migrations up on test DB (undo/redo verified); models; qna-copilot-models 6/6.
- Task 8 done 2026-10-25: prompts and parsers; qna-prompts 8/8.
- G3 (tasks 6–7) done 2026-10-25: visibility 8/8; existing Q&A files 55/55; realtime qna 13/13; unit 139/139 (131 + 8 prompt tests); api typecheck 0.
- Task 9 done 2026-10-25: seven node functions; nodes.test 1/1 (centroid); qna-copilot-nodes 8/8; knowledge-search 5/5 and ai-runner 10/10 after the shared changes; unit 140/140; api typecheck 0. Changes outside the brief: `searchKnowledgePassages` added to knowledge-search (HTTP search output unchanged); fake provider given Q&A default replies.
- Decision (agent, accepted 2026-10-25): a grounded draft stays DRAFTING until its self-check passes, then becomes PENDING_REVIEW. Stronger than the plan: the presenter can never approve an unchecked draft.
- Task 10 done 2026-10-25: graph (START by ai_step; retry edges capped by draft_attempts); task registered; runner `onGiveUp` hook in three places; English query recovered by repeating the read-only moderation prompt on resume (no new column). Verified: unit 141/141; graph 7/7; runner, jobs and suggestion flow 26/26; typecheck 0.
- Task 11 done 2026-10-25: endSession cancels drafts and holds CHECKING questions after the knowledge delete, before cancelPendingAiJobs. Verified: session-end, poll and word files 17/17; typecheck 0.
- Gap for task 14: nothing tells the room when a question is released from HELD.
- Task 12 done 2026-10-25: presenter service; service integration 10/10; unit 141/141; typecheck 0.
- Task 13 done 2026-10-25: routes, controller, rate limit `qna-copilot:<sessionId>` (60/min); held-question label now nullable in review (never classified shows no label); routes+service 20/20; shared 130/130.
- Task 14 done 2026-10-25: presenter-room review and cluster events; room events for approve (question:updated), release (question:created), merge (question:upvotes). Room filter fixed: HELD and CHECKING text no longer reaches the room (found by the agent). Verified: copilot events 8/8; qna-live and qna-secrecy 13/13; unit 141/141; typecheck 0.
- Not covered by a test: the room event for a give-up release (fail-open after a failed job).
- Tasks 15–16 done 2026-10-25: web client, hook, review panel, clusters, participant status. Web typecheck 0; eslint 0; tests 169/169.
- Task 17 done 2026-10-25: docs 04, 05, 07, 10 (section 5.3), Hindi stage-10.
- Full API integration run 2026-10-25 (alone): 76 files, 506 passed, 1 skipped, exit 0. Unit 141/141; shared 130/130.
- Status stays `in_progress` until the live checks run: a real model's replies, and the realtime event for a fail-open release (no test).

### Approvals needed
1. `@langchain/langgraph@1.4.21` with transitive deps (`langgraph-sdk`, `langgraph-checkpoint`, `protocol`), and the zod
   range bump in the api package.
2. Three migrations with destructive downs (test DB only).
3. Changes to the shared question create, list and upvote paths, the runner (`onGiveUp` hook), `endSession` and
   `cancelPendingAiJobs`.
4. Five new presenter routes and two presenter events.
5. Approved answers reach the room through the existing `question:updated` event.

### Risks
| Level | Risk | Mitigation |
|---|---|---|
| HIGH | Unsupported claim reaches the room | Grounding, self-check, approval gate, one write path |
| HIGH | Held or CHECKING text leaks to the room | One SQL filter, mapper guard, socket tests |
| HIGH | Lock-order deadlock with upvote or session end | Fixed order: session → advisory → questions → draft; concurrent tests |
| HIGH | Fail-open lets unmoderated text through when AI is off or fails | Presenter can hide; open question 1 |
| MEDIUM | English-only embedder weak for non-English dedupe | Embed `englishQuery` from moderation |
| MEDIUM | Tokens lost if the server crashes mid-run | One reservation per job; finished nodes not re-run |
| LOW | Noisy clusters | Shown from 3 questions; presenter-only |

### Open questions (with the planner's recommendation)
1. **Fail-open or fail-closed when moderation cannot run?** Recommended: fail-open, to meet behaviour 12. Note: with AI off,
   questions appear unmoderated. Decide explicitly.
2. A released question gets a draft? Recommended: no; the presenter answers by hand.
3. Approve a draft for a question already answered by hand? Recommended: 409 `QUESTION_ALREADY_ANSWERED`.
4. Cluster labels from the LLM or the earliest question's text? Recommended: question text (no extra tokens).
5. Separate fast model for moderation (`AI_FAST_MODEL`)? Recommended: defer; use `AI_MODEL` with a small output cap.
6. Asker sees "waiting for review" for HELD questions? Recommended: show "Checking…" only.

## Approval
- Plan v1 approved by the developer on 2026-10-25 with the recommended answers: new package `@langchain/langgraph@1.4.21` (exact) and the api zod range bump; three migrations (destructive downs on the test DB only); shared path changes (question create, list, upvote, runner hook, endSession, cancelPendingAiJobs); five presenter routes and two presenter events. Execution started.

## Decisions
- Fail-open when moderation cannot run: new questions show to the room straight away (developer choice, 2026-10-25). Risk accepted: questions are unmoderated while AI is off or failing; the presenter can still hide any question. Open questions 2–6 take the recommended answers.

## Issues & updates
- 2026-10-25 · MEDIUM · A job that resumes mid-run does not have the English query (it is not stored), so later dedupe and retrieval use the original text. Affects non-English questions only. Open: task 10 must re-run moderation when the English query is missing, or the query must be stored.

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-25 | plan_created | Plan v1 drafted by planner; six open questions with recommendations; new package and destructive migrations listed; awaiting approval | planning-tracking.md |
