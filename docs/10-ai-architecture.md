# 10 — AI Architecture (LLM · RAG · LangChain · LangGraph · pgvector · MCP)

LivePulse's differentiator is an **AI co-pilot for the presenter**. The live-engagement core (sessions, polls,
word cloud, Q&A, reactions) works without AI; the AI layer reads from it, suggests, and the presenter decides.

## 1. Principles

1. **Human in the loop.** AI never publishes to the audience by itself. It drafts (poll, answer, summary); the
   presenter approves, edits, or dismisses. Exception: moderation may _hold_ a question for review.
2. **Core never depends on AI.** If the LLM is down, slow, or disabled, polls/Q&A/reactions keep working. AI
   features show "AI unavailable" and retry.
3. **PostgreSQL stays the source of truth.** Embeddings live in PostgreSQL via `pgvector` — no separate vector
   database to run, back up, or keep consistent. AI outputs are persisted before they are emitted.
4. **Async, after commit.** AI work never runs inside an HTTP request or a DB transaction. A committed write
   creates an `ai_jobs` row; a runner processes it and emits `ai:*` events when done.
5. **Structured, validated outputs.** Every LLM response is parsed against a Zod schema. Invalid output → retry
   once → job FAILED with a safe message. Never render unvalidated model output.
6. **Audience text is untrusted.** It is data inside delimited prompt sections, never instructions. The model
   never gets tools that change state on behalf of an audience member (see §8).
7. **Honest labelling.** Everything AI-generated is labelled "AI suggestion" / "AI draft" in the UI. The
   deterministic word cloud stays deterministic and is not called AI.
8. **Testable offline.** A `fake` LLM provider and deterministic embeddings make every test and an offline demo
   run with no network and no cost.

## 2. Stack choices

| Concern             | Choice                                                                                                        | Why                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| LLM                 | Anthropic Claude via `@langchain/anthropic`                                                                   | Strong reasoning + structured output. Model ID in env (`AI_MODEL`), default `claude-opus-5-5`.                              |
| Optional fast model | `AI_FAST_MODEL` (open decision: same as `AI_MODEL`, or `claude-haiku-5-5` for moderation/classification)      | Cheaper/faster for high-volume, simple tasks. Developer decides.                                                            |
| Orchestration       | LangChain.js (`@langchain/core`)                                                                              | Prompt templates, retrievers, output parsers, provider swap.                                                                |
| Agent workflows     | LangGraph.js (`@langchain/langgraph`)                                                                         | Explicit state machine for multi-step flows (Q&A co-pilot), conditional edges, retries, inspectable state.                  |
| Embeddings          | Local model via Transformers.js (e.g. `all-MiniLM-L6-v2`, 384 dims), behind an `EmbeddingsProvider` interface | Free, offline, no data leaves the machine. Anthropic has no embeddings endpoint. A hosted provider can be swapped in later. |
| Vector store        | PostgreSQL `pgvector` extension, HNSW index, cosine distance                                                  | One database; transactions + joins with session data; Sequelize migrations manage it.                                       |
| Retrieval           | Custom LangChain `BaseRetriever` over a parameterised Sequelize query                                         | Keeps the "Sequelize only" rule (no second DB client/ORM such as `PGVectorStore`).                                          |
| Tool protocol       | MCP server (`@modelcontextprotocol/sdk`, TypeScript)                                                          | Lets Claude Desktop / Claude Code drive a live session with the same service layer and authorization.                       |
| Docker image        | `pgvector/pgvector:pg16` instead of `postgres:16`                                                             | Same PostgreSQL, extension preinstalled.                                                                                    |

All packages above are **new dependencies** and need explicit approval when the phase that introduces them runs
(`/execute` approval gate). Pin exact versions.

### Known integration risks (verify in Phase 9 before building on them)

- Current Claude models reject `temperature` / `top_p` / `top_k` (400) and reject forced `tool_choice`
  (`any` / `tool`). Some LangChain helpers (e.g. `withStructuredOutput` in tool-calling mode) force a tool call by
  default. Use the provider's JSON-schema / structured-output mode or `tool_choice: auto`, and make sure no
  sampling params are sent. Add a smoke test that runs one real call when `AI_PROVIDER=anthropic`.
- Thinking cannot be disabled on `claude-opus-5-5`; control cost/latency with the effort setting instead.
- Changing the embedding model changes the vector dimension → migration + re-embed. Dimension is a constant in
  `shared/` and in the migration.

## 3. Component map

```mermaid
flowchart LR
  subgraph API[Express API process]
    SVC[Domain services<br/>polls · qna · words · reactions]
    JOBS[(ai_jobs table)]
    RUNNER[AI job runner<br/>bounded concurrency]
    subgraph AI[ai/ module]
      LLM[LlmProvider<br/>anthropic · fake]
      EMB[EmbeddingsProvider<br/>local · fake]
      RET[KnowledgeRetriever<br/>pgvector]
      G1[LangGraph: qna-copilot]
      C1[Chain: poll-generator]
      C2[Chain: live-insights]
      C3[Chain: session-report / ask-session]
      GUARD[Budget + rate guard]
    end
  end
  MCP[MCP server<br/>stdio · REST client]
  PG[(PostgreSQL + pgvector)]
  IO[Socket.IO + Redis adapter]
  SVC -->|commit, then enqueue| JOBS
  RUNNER --> JOBS
  RUNNER --> G1 & C1 & C2 & C3
  G1 & C1 & C2 & C3 --> LLM & RET & GUARD
  RET --> EMB
  RET --> PG
  RUNNER -->|persist result, commit| PG
  RUNNER -->|then emit ai:*| IO
  MCP -->|REST + presenter key| SVC
```

## 4. AI job lifecycle

1. A domain event commits (question submitted, document uploaded, presenter clicks "Suggest polls").
2. The service inserts `ai_jobs(type, session_id, input, status=PENDING)` in the same transaction.
3. After commit, the runner is nudged (in-process). On startup it also picks up PENDING/stale RUNNING jobs, so a
   restart does not lose work.
4. Runner claims the job (`UPDATE … SET status='RUNNING' WHERE id=? AND status='PENDING'` — one claimer wins),
   checks the session budget, runs the chain/graph, validates output with Zod.
5. Result rows (`ai_poll_suggestions`, `ai_answer_drafts`, `ai_insights`, …) and job status `SUCCEEDED` are
   written in one transaction, with token usage and model ID recorded on the job.
6. After commit, emit the matching `ai:*` event to the **presenter room only** (or session room for approved
   content).
7. On failure: retry with backoff up to `AI_MAX_ATTEMPTS`, then `FAILED` with a safe error code; emit
   `ai:job-failed` to the presenter.

A durable queue (e.g. BullMQ on Redis) is a documented future option; for the prototype the PostgreSQL job table
is enough and keeps one source of truth.

## 5. Features

### 5.1 Knowledge base (RAG ingestion) — Phase 10

- Presenter uploads slides/notes: PDF, Markdown, or plain text (size and page limits enforced).
- Pipeline: extract text → normalise → chunk (~500–800 tokens, ~15% overlap, keep page/heading metadata) →
  embed in batches → store `knowledge_chunks(content, embedding, page, heading)` → document `READY`.
- Retrieval is **hybrid** (see §5.7A): pgvector cosine top-20 and PostgreSQL full-text top-20, both **filtered by
  `session_id`**, fused with Reciprocal Rank Fusion, then reranked to top-5. Minimum similarity threshold applies;
  return chunks with citation metadata.
- No match above threshold → the AI must say it does not know (no fabrication).

### 5.2 AI poll generator — Phase 11 (LangChain chain)

- Input: presenter topic/instruction + retrieved chunks + recent Q&A themes.
- Output (Zod): 1–3 polls, each `{ question, options[2–6], rationale, sourceChunkIds[] }`.
- Presenter sees suggestions, can edit, then "Create poll" → normal poll (DRAFT) via the existing poll service.
- Optional: quiz mode with a marked correct option (only if requested in the requirement).

### 5.3 AI Q&A co-pilot — Phase 12 (LangGraph)

Built design (`api/src/ai/tasks/qna-copilot/`). One `QNA_COPILOT` job per question runs the whole graph.

```mermaid
stateDiagram-v2
  [*] --> routeByStep
  routeByStep --> moderate: step = moderate
  routeByStep --> embed: step = embed
  routeByStep --> dedupe: step = dedupe
  routeByStep --> retrieve: step = retrieve
  routeByStep --> draft: step = draft
  routeByStep --> selfCheck: step = selfCheck
  routeByStep --> awaitPresenter: step = awaitPresenter
  moderate --> embed: OK
  moderate --> [*]: TOXIC, SPAM, OFF_TOPIC or PII (held)
  embed --> dedupe
  dedupe --> [*]: near-duplicate (merged)
  dedupe --> retrieve: new question (visible, in a cluster)
  retrieve --> draft
  draft --> selfCheck
  draft --> draft: no usable reply (max 2 attempts)
  selfCheck --> awaitPresenter: supported
  selfCheck --> draft: unsupported (max 2 attempts)
  selfCheck --> awaitPresenter: attempts used up (NOT_COVERED)
  awaitPresenter --> [*]
```

- **Table as checkpoint.** Each node commits its result and `questions.ai_step` in its own short transaction. No
  LangGraph checkpointer is used. A START router reads `ai_step`, so a recovered job resumes at the node after the last
  committed one. Finished nodes are not run again.
- **Provider calls in three nodes only.** `moderate` returns the label, a reason, the question's `language` and an
  English query. `draft` writes the answer from the ready passages, with citations. `selfCheck` is a separate call that
  checks every claim against the cited passages. Parse failure counts as "not supported".
- **English query for dedupe and retrieval.** The local embedder is English-only, so `embed`, `dedupe`, clusters and
  retrieval use the English query from `moderate`. Non-English questions are answered in their own language.
- **moderate.** Classifies `{ label: OK | TOXIC | SPAM | OFF_TOPIC | PII, reason }`. A question that is not OK becomes
  HELD: presenter only, released or rejected by the presenter. No draft is made.
- **embed and dedupe.** One transaction with the session and advisory locks. A question at or above
  `QNA_DUPLICATE_SIMILARITY` (0.90) becomes MERGED, `duplicate_of_id` is set, and the asker's upvote moves to the
  canonical question. Otherwise it becomes VISIBLE and joins the nearest cluster (`QNA_CLUSTER_SIMILARITY`, 0.75) by
  running-mean centroid.
- **retrieve and draft.** Only READY passages of the session are used. No ready passage means "Not covered in the
  materials" with no model call. A draft is `GROUNDED` (with at most three citations) or `NOT_COVERED`, and is at most
  500 characters, one line, plain text. A grounded draft is retried once if it has no valid citation or is not
  supported.
- **selfCheck and the approval gate.** A grounded draft stays DRAFTING until its self-check passes, then becomes
  PENDING_REVIEW. The presenter can never approve an unchecked draft. A draft that is still unsupported after its
  attempts is marked NOT_COVERED.
- **awaitPresenter.** The draft is persisted as `ai_answer_drafts` in PENDING_REVIEW, and `qna:review-updated` goes to
  the presenter room. Nothing is shown to the room.
- **Resume.** The English query is not stored. On resume, a run that needs it repeats the read-only moderation prompt
  to recover it. `draft_attempts` and the UNIQUE draft row per question prevent a second draft.
- **Fail-open.** If AI is off, over budget or not usable when the question is submitted, the question is VISIBLE at once
  and no job runs. If a run fails and gives up, its question is released to VISIBLE. A release after a failed run is
  not moderated; the presenter can still hide it.
- **Approval.** The presenter may edit the draft text (500 characters at most). Approval writes only the approved text
  to the question's `answer_text`, with citations reduced to document name and location, and no quote text. The room
  gets the id-only `question:updated` and refetches. No draft text travels over a socket. Approval survives restarts
  because it is stored in the table.
- **Session end.** Open drafts become CANCELLED. Questions still CHECKING become HELD. Approved answers remain.

### 5.4 Live audience insights — Phase 13

- **Semantic word themes**: cluster word-cloud responses by embedding similarity ("collab", "teamwork",
  "working together" → one theme), LLM names each theme. Shown next to (not instead of) the exact-count cloud.
- **Sentiment pulse**: classify recent responses/questions + reaction mix into a rolling room mood
  (positive/neutral/confused/negative) with a short reason.
- **Room summary on demand**: "What is the room thinking right now?" → 3–5 bullets with evidence counts.
- Debounced: recompute at most every `AI_INSIGHTS_INTERVAL_SECONDS` and only when new input arrived.

### 5.5 Post-session report + "Ask your session" — Phase 14 (built)

Built design (`requirements/ai-session-report/`). Facts only: the report has no AI-written narrative, takeaways, themes or sentiment timeline. Those are not built.

- **Report (no AI, no table).** The report is computed from the session's data on each read, in one read-only REPEATABLE READ transaction with aggregate queries: poll results, top word-cloud terms, question counts, top-upvoted questions, knowledge documents and AI usage. Knowledge documents are removed when the session ends, so after the end the report shows a count of successful ingests instead of names. Export is the same DTO as JSON.
- **Chat over read-only tools.** Each question builds a DTO snapshot of the session. The model gets a fixed set of read-only tools that run over that snapshot. They take no session id, cannot write, and cannot reach another session. Tool results are capped and wrapped as untrusted data; the system prompt says to answer only from tool results. A turn is limited to 4 tool rounds and 45 seconds.
- **Streaming on the POST response.** The provider's streaming method (`converse`) yields text deltas, tool calls and usage. The answer is sent as SSE on the response to `POST /sessions/:id/report/chat`, so only the presenter's request receives it and no socket room is used. Closing the connection aborts the model call.
- **Server-decided sources.** Each tool result carries server references (poll, word prompt, question, document, AI usage) that the server maps to labels. Citations the model writes are ignored.
- **Budget.** A question reserves tokens with an `ai_jobs` row of type `SESSION_REPORT`, status RUNNING, `max_attempts = 1`, `reserved_tokens = 8000` and `dedupe_key = 'report-chat'`, taken under the session row lock. Settle charges the real tokens, releases the reservation and emits `ai:usage` to the presenter room. Only one streaming turn runs per session at a time.
- **Incomplete answers.** A failed, aborted, timed-out, capped or over-round answer is settled `INCOMPLETE` with an error code and keeps its partial text. A reservation left by a crash is released by recovery, because `max_attempts = 1`; history shows orphaned turns as `INCOMPLETE`.
- **After the end.** Chat stays allowed after the session ends when AI was on. AI cannot be turned on after the end, so a session that ended with AI off has no chat.
- **Storage.** `session_chat_turns`: one row per question and answer; `client_message_id` unique per session; `question` up to 500 characters; `answer` up to 8,000 characters; bounded `sources` jsonb; deleted with the session.

### 5.6 MCP server — Phase 15

A separate entry point (`api/src/mcp/`) over stdio exposing presenter tools. Each tool is a thin call to the
LivePulse REST API with the presenter key, so authorization, validation, and emit-after-commit rules are
identical to the web UI and there is no second write path. Tool inputs are Zod-validated (shared schemas).

| Tool                     | Effect                                                              |
| ------------------------ | ------------------------------------------------------------------- |
| `get_session_snapshot`   | Read: session state, polls, top questions, recent AI actions        |
| `suggest_polls`          | Read: runs the poll generator and returns suggestions               |
| `list_questions`         | Read: visible questions (max 50)                                    |
| `get_session_report`     | Read: the session report                                            |
| `propose_create_poll`    | Proposal: stores a pending CREATE_POLL action                       |
| `propose_start_poll`     | Proposal: stores a pending START_POLL action                        |
| `propose_close_poll`     | Proposal: stores a pending CLOSE_POLL action                        |
| `propose_publish_answer` | Proposal: stores a pending PUBLISH_ANSWER action                    |

Writes are proposals only. A `propose_*` tool stores an action with status `PROPOSED`. The audience sees nothing
until the presenter approves it in the AI panel (see `04-api-contract.md`, AI actions).

No MCP resources; the snapshot is a tool. Config via env in the Claude Desktop MCP entry:
`LIVEPULSE_API_URL`, `LIVEPULSE_SESSION_ID`, `LIVEPULSE_PRESENTER_KEY` (one session per key). Demo: in Claude Desktop, "create a poll about pricing in my session", approve it in the AI panel → audience phones update
live.

### 5.7 Differentiators — what makes this more than a chatbot

Each item maps to a phase and a behaviour that can be tested or measured. Model routing for all of them: Opus 5.5
(`AI_MODEL`) for reports, poll generation, answer drafts and the ask-session chat; the fast model (`AI_FAST_MODEL`,
proposed `claude-haiku-5-5`) for moderation, language detection and cluster labels. Effort is set per route.

**A. Hybrid retrieval with reranking (Phase 10).** Pure vector search misses exact terms: product names, prices,
slide titles, codes. Retrieval runs two queries in parallel — pgvector cosine top-20 and PostgreSQL full-text
(`tsvector` with a GIN index, `ts_rank`) top-20 — both scoped to `session_id`. Results are fused with Reciprocal
Rank Fusion (`score = Σ 1 / (60 + rank)`). A local cross-encoder reranker (ONNX model via Transformers.js; the
exact model is confirmed in the Phase 10 plan) scores the fused top-20 and keeps five. Quality is measured as
recall@5 on labelled fixtures, hybrid versus vector-only (§9).

**B. Live question clusters (Phase 12).** Each new question joins the nearest cluster centroid above a similarity
threshold, or starts a new cluster. Centroids are kept as running means on `question_clusters`. Each cluster has
an LLM-written label ("Pricing for small teams — 12 questions"). The presenter sees clusters sorted by size and can
answer a whole cluster with one approved draft. Duplicate merging (§5.3) is the tight case of this; clusters are
the wider view for the presenter.

**C. Pulse Coach (Phase 13).** A presenter-only advisor watching live signals: a spike in 🤔 reactions, a cluster
growing fast, a poll that splits close to 50/50, or confusion-type themes in word responses. Triggers are
deterministic rules, so they are cheap and testable. The LLM only writes the suggestion, for example "40% of the
room is asking about pricing — a 60-second recap slide, or a poll on which plan they are considering?".
Suggestions are dismissable and never act on their own. What the coach suggested and what the presenter did is
logged, so the report can cover it.

**D. Multilingual audience (Phase 12).** A participant asks in any language. The fast model detects the language
and translates the question into the presenter's language. The presenter answers in their own language, and the
answer is shown back in the asker's language. The original text is always kept and can be shown on request.

**E. Approval-gated actions for Claude and the in-app assistant (Phase 15).** Every write an AI makes is a
proposal, not an action. Claude (via MCP) or the in-app assistant calls `propose_*` tools (create poll, start poll,
close poll, publish answer). Each proposal is stored in `ai_actions` (`PROPOSED → APPROVED | REJECTED → EXECUTED |
FAILED`) and appears in the presenter's AI panel. Executing an approved action calls the same REST service as the
web UI. Read-only tools run without approval. For multi-step plans ("after the pricing question, run a poll on plan
choice, then close it after two minutes"), a LangGraph graph pauses at an interrupt node until each step is
approved. Pending state lives in PostgreSQL, so approvals survive a restart. Checkpointing with
`@langchain/langgraph-checkpoint-postgres` is an option to decide in the Phase 15 plan; the default is our own
`ai_actions` table, which needs no extra package.

**F. Tool-using "Ask your session" (Phase 14).** Instead of stuffing everything into one prompt, the model gets a
small set of strict, read-only tools: `get_poll_results`, `search_questions`, `get_word_themes`,
`search_materials`. The server binds every tool to the presenter's session; the model cannot pass a session ID.
Answers cite tool results. Each tool call is recorded on the job. Tools use strict JSON schemas and `tool_choice:
auto` (current models reject forced tool use).

## 6. Prompt management

- Prompts live in code as versioned templates (`api/src/ai/prompts/<name>.v1.ts`), not in the DB.
- Each job records `prompt_version` and `model` for traceability.
- System prompt states the role, the delimiting convention for untrusted text (`<audience_input>…</audience_input>`),
  the output schema, and "say you don't know when sources don't cover it".
- Keep the stable prefix first (system + instructions) so prompt caching can apply.

## 7. Cost, latency, and limits

- Per-session token budget (`AI_SESSION_TOKEN_BUDGET`) checked before every call; exceeded → feature pauses with
  a clear presenter message.
- Global kill switch `AI_ENABLED=false`; per-session toggle by the presenter.
- Bounded runner concurrency (`AI_MAX_CONCURRENCY`) and per-session job dedupe (no two insight jobs queued).
- Timeouts on every LLM call; streaming for long outputs (report, ask-session).
- Usage (input/output tokens, latency) stored on `ai_jobs` and visible on a small presenter "AI usage" panel.

## 8. AI security (summary — details in 06)

- Prompt injection: audience text delimited and labelled untrusted; the model gets no state-changing tools in
  audience-triggered flows; outputs are schema-validated and rendered as text.
- Data minimisation: send display names to the LLM only when needed (default: omit them).
- Secrets: `ANTHROPIC_API_KEY` only from env, never logged, never sent to the browser.
- Disclosure: presenter enables AI per session and sees "audience text is sent to an external AI provider" when
  `AI_PROVIDER=anthropic`.

## 9. Evaluation

- Golden set in `api/tests/ai/fixtures/`: ~20 questions with expected grounded/ungrounded outcome, ~10 duplicate
  pairs, ~10 moderation cases, 3 documents.
- Automated checks (fake provider in CI): graph routing, schema validation, threshold logic, retrieval ranking.
- Manual/opt-in eval run with the real model (`npm run eval:ai`, needs approval because it costs money): report
  groundedness, duplicate-detection precision, moderation accuracy. Never claim scores that were not measured.
- RAG metrics on the golden set: retrieval recall@5 (hybrid vs vector-only), faithfulness and answer relevance
  (LLM judge with a fixed rubric), cluster purity on labelled questions, language-detection accuracy. Each run
  records model, prompt version and date.
