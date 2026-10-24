# 12 — CTO Demo Script and Talking Points

## 1. Ten-minute demo

Setup: laptop (presenter) on a projector, 2–3 phones/browsers as audience, a short sample deck PDF uploaded
beforehand (or live in step 3). Have the offline (`fake` AI) mode ready as a backup.

| # | Action | What it proves |
|---|---|---|
| 1 | Create session "AI in Product Teams"; show the room code; phones join | Fast join, no accounts, token-scoped identity |
| 2 | Presenter count ticks up; toggle a phone to airplane mode and back — it recovers | Socket.IO presence, reconnect + state recovery |
| 3 | Upload deck on the knowledge page → READY; search "pricing" shows the passage + page | RAG ingestion, pgvector retrieval, citations |
| 4 | "Suggest polls" → AI proposes 3 grounded polls → edit one → start | LangChain chain + structured output + human in the loop |
| 5 | Phones vote; bars move live; try voting twice → rejected | Transactional voting, DB uniqueness, live fan-out |
| 6 | Word cloud "one word for AI at work" → cloud + AI themes side by side | Deterministic counts vs labelled AI semantics |
| 7 | Phones ask questions; one abusive → held; a paraphrase → merged | LangGraph moderation + embedding dedupe |
| 8 | Cited answer draft appears → presenter edits + approves → phones show it | Grounded RAG answers, approval gate |
| 9 | Ask something not in the deck → draft says "not covered" | No hallucination by design |
| 10 | Everyone taps 👏 → burst; click "What is the room thinking?" | Throttled realtime + live insights |
| 11 | In Claude Desktop: "Start a poll on what confused people most" → phones update | MCP: AI agents operating the product safely |
| 12 | End session → AI report with real numbers → "Ask your session: what should I follow up on?" (streams) | Report grounded in SQL aggregates, streaming RAG chat |
| 13 | Optional: second API instance; phone on instance B receives poll from A | Redis adapter horizontal fan-out |
| 14 | Optional: set `AI_ENABLED=false`, restart → polls/Q&A still work | Core never depends on AI |

Never show fake counts. If seed data exists it's labelled "demo".

## 2. Architecture in 60 seconds
"The browser uses REST for commands and snapshots and Socket.IO for live updates. Express validates with Zod and
calls domain services; Sequelize persists to PostgreSQL, the single source of truth — including embeddings via
pgvector. Every write commits first, then emits; the Redis adapter fans events out across API instances, and
clients re-fetch on reconnect because Pub/Sub isn't durable. AI runs as background jobs recorded in PostgreSQL:
LangChain chains for poll generation and insights, a LangGraph state machine for the Q&A co-pilot, Claude as the
LLM, local embeddings for retrieval. AI only drafts — the presenter approves. The same service layer is exposed
to Claude Desktop through an MCP server, so agents get exactly the same authorization as the UI."

## 3. Likely CTO questions

**Why pgvector instead of Pinecone/Weaviate/Qdrant?** One database, transactional consistency with session data,
session filtering via plain SQL, nothing extra to operate. Swap later behind the retriever interface if scale
demands (millions of chunks, multi-tenant ANN tuning).

**Why LangGraph for Q&A but plain chains elsewhere?** Q&A has branching (hold / merge / answer), a retry loop
(self-check), and a human approval step — a state machine makes it explicit and testable. Poll generation is one
call with structured output; a graph would be extra code.

**How do you stop hallucinations?** Retrieval scoped to the session, similarity threshold, citations required,
self-check node, "not in the material" path, and a human approval gate. And we never let the LLM produce report
numbers — SQL does.

**Prompt injection?** Audience text is fenced as data, the model has no state-changing tools in audience flows,
outputs are schema-validated, and nothing publishes without the presenter.

**Cost control?** Per-session token budget, debounced insights, job dedupe, optional cheaper model for
classification, usage panel per session, kill switch, prompt caching on stable prefixes.

**What if the LLM is down?** Jobs retry then fail visibly; polls, Q&A, word cloud, reactions keep working.

**Why MCP?** It turns LivePulse into a tool any AI agent can operate — the presenter's assistant can run the
session — reusing the same API, so there's no second authorization model.

**Two votes at the same time?** Unique `(poll_id, participant_id)` + row lock on the poll; concurrency tests prove
one row. Close vs vote serialize on the same lock.

**How does it scale?** Stateless API instances behind a WebSocket LB, Redis adapter, PostgreSQL pooling and HNSW
index, AI runner moved to separate workers/durable queue when needed, reaction bursts aggregated server-side.

**Why a modular monolith?** Small domain, one team; easy to test and explain. Seams (`ai/`, `realtime/`, services)
are where we'd split if scaling or ownership demanded it.

## 4. Be honest about limitations
No production security audit · no load-test capacity claims · not exactly-once delivery · Redis Pub/Sub not
durable · presenter key instead of accounts · anonymous participants · AI can be wrong, hence human approval ·
real-model eval numbers only if actually measured.
