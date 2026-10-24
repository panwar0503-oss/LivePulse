# LivePulse documentation

LivePulse is a StreamAlive-inspired, **AI-assisted** live audience engagement prototype (polls, word cloud,
Q&A, reactions) built to demo product and engineering depth to CTOs. An AI co-pilot — Claude via LangChain and
LangGraph, RAG over the presenter's material with pgvector, and an MCP server for Claude Desktop — helps the
presenter while every AI output stays a draft until a human approves it.

Original product: do not copy StreamAlive branding, assets, code, or page designs.

## Read in this order

| Doc | What's in it |
|---|---|
| [01-product-requirements.md](01-product-requirements.md) | Roles, scope (core + AI), routes, rules, acceptance criteria |
| [02-architecture.md](02-architecture.md) | System diagram, layout, write flows, Redis adapter, failure semantics |
| [10-ai-architecture.md](10-ai-architecture.md) | LLM, RAG, LangChain, LangGraph, pgvector, MCP — design, guardrails, eval |
| [03-data-model-sequelize.md](03-data-model-sequelize.md) | Tables, constraints, pgvector, migration rules |
| [04-api-contract.md](04-api-contract.md) | REST endpoints by phase |
| [05-realtime-events.md](05-realtime-events.md) | Socket.IO rooms and events |
| [06-security-privacy.md](06-security-privacy.md) | Threats and controls, incl. AI-specific ones |
| [07-test-plan.md](07-test-plan.md) | Test layers and critical scenarios |
| [08-implementation-plan.md](08-implementation-plan.md) | **Phase roadmap** (one requirement per phase) |
| [11-phase-prompts.md](11-phase-prompts.md) | **Copy-paste `/requirement` + `/execute` per phase** |
| [09-local-development.md](09-local-development.md) | Docker, env, scripts, troubleshooting |
| [12-demo-and-interview.md](12-demo-and-interview.md) | CTO demo script and Q&A prep |
| [13-definition-of-done.md](13-definition-of-done.md) | Release checklist |

## Key decisions
1. PostgreSQL is the source of truth, including embeddings (pgvector). No separate vector DB.
2. Sequelize for models, migrations, and transactions; vector queries are parameterised Sequelize raw queries.
3. Commit, then emit. Redis adapter for cross-instance fan-out; clients re-fetch on reconnect.
4. AI runs as background jobs recorded in PostgreSQL, after commit, never in the request path.
5. AI drafts; the presenter decides. Everything AI-made is labelled.
6. Core features never depend on AI; `fake` provider for tests and offline demo.
7. Presenter key (no accounts) and session-scoped participant tokens; room code is discovery only.

## How we use Claude Code

`docs/claude-workflow/` explains, in plain English, how Claude Code is set up for this project: CLAUDE.md, rules,
commands, agents, skills, memory, settings and hooks, with a worked example. Start at its
[README](claude-workflow/README.md).

## Where other docs go
Feature requirements and plans: `requirements/<feature>/`. Docs produced while building go in
`docs/<category>/kebab-case.md` (`architecture/`, `setup/`, `guides/`). The numbered files above are the master
spec.
