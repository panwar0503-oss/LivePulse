# 08 — Implementation Roadmap (phases)

Each phase is **one requirement folder** built with `/requirement <name>` → `/execute <name>`. Copy-ready prompts
are in `11-phase-prompts.md`. Don't start a phase until the previous one is `completed` and you approve the next.

Every phase that touches the UI ships its own UI (full-stack slice), so each phase ends with something you can
demo.

| Phase | Requirement name | Delivers | Depends on | New deps (approve at `/execute`) |
|---|---|---|---|---|
| 1 | — | Claude Code workflow + docs | — | — ✅ done |
| 2 | `foundation` | Monorepo, Docker (pgvector + Redis), env, Sequelize + migrations, logging, errors, health/ready, Next.js shell | 1 | express, sequelize, pg, zod, socket.io, redis, vitest, supertest, next, tailwind… |
| 3 | `sessions-and-join` | Create session, room code, presenter key, join with token, landing/create/join pages | 2 | — |
| 4 | `realtime-backbone` | Socket.IO + Redis adapter, handshake auth, rooms, presence, state snapshot, reconnect, session end | 3 | @socket.io/redis-adapter |
| 5 | `live-polls` | Polls, lifecycle, transactional voting, live results, visibility | 4 | — |
| 6 | `word-cloud` | Prompts, responses, normalisation, live cloud | 4 | — |
| 7 | `live-qna` | Questions, upvotes, presenter moderation, live ordering | 4 | — |
| 8 | `live-reactions` | Emoji reactions, throttled bursts, per-minute counts | 4 | — |
| 9 | `ai-foundation` | LLM + embeddings providers (real + fake), pgvector, ai_jobs runner, budget, kill switch, AI usage panel | 2–4 | @langchain/core, @langchain/anthropic, @langchain/langgraph, Transformers.js, (pgvector) |
| 10 | `knowledge-base-rag` | Upload, chunk, embed, hybrid keyword + vector retrieval with reranking, citations, knowledge page | 9 | PDF text extraction lib |
| 11 | `ai-poll-generator` | Grounded poll suggestions → create poll | 5, 10 | — |
| 12 | `ai-qna-copilot` | LangGraph: moderate → dedupe → retrieve → draft → self-check → presenter approval; live question clusters; multilingual questions | 7, 10 | — |
| 13 | `ai-live-insights` | Semantic word themes, sentiment pulse, room summary, Pulse Coach suggestions | 6, 8, 9 | — |
| 14 | `ai-session-report` | Post-session report, tool-using "Ask your session" streaming chat (read-only session tools) | 5–13 | — |
| 15 | `mcp-server` | MCP tools for Claude Desktop/Code; approval-gated actions (`ai_actions`); LangGraph plans with approval interrupts | 5, 11, 12, 13 | @modelcontextprotocol/sdk |
| 16 | — (`/code-review`, `security-reviewer`) | Hardening: QA + security review, fixes via `/bug-fix` | 2–15 | — |
| 17 | `demo-readiness` | Demo seed data, README, two-instance script, rehearsal checklist | 16 | — |

### Minimum demo-worthy path (if time is short)
2 → 3 → 4 → 5 → 7 → 9 → 10 → 12 → 11 → 15 → 17.
This shows live polls + Q&A plus the strongest AI story (RAG + LangGraph + MCP). Word cloud, reactions, insights
and report come next.

### Exit criteria for every phase
- Requirement success criteria all ✔ with commands and real results recorded in `planning-tracking.md`.
- Tests for the phase pass; earlier tests still pass.
- Migrations run `up` and `down` on a clean DB (if any).
- The phase's "demo moment" (in `11`) works in the browser.
- `docs/` updated only if architecture/setup changed.
- You commit (Claude doesn't).

### Non-goals throughout
Microservices, billing, accounts/SSO, native mobile, separate vector DB, model fine-tuning, StreamAlive parity.
