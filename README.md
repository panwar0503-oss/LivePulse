# LivePulse

Interactive live audience engagement prototype (polls, Q&A, reactions) — web frontend + backend.

| Part           | Stack                                                                                   | Status                               |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------ |
| `api/`         | Express 5, TypeScript, Sequelize, PostgreSQL, Redis, Zod                                | foundation: health/ready, migrations |
| `web/`         | Next.js 15, React 19, TypeScript, Tailwind CSS v4                                       | foundation: landing shell            |
| `shared/`      | Zod schemas for API responses                                                           | foundation                           |
| AI (in `api/`) | Claude via LangChain.js + LangGraph.js, RAG with pgvector, local embeddings, MCP server | planned (Phase 9+)                   |

Spec and phase roadmap: [`docs/README.md`](docs/README.md).

## Prerequisites

- Node.js 20 or newer (includes npm) — `node --version`
- Docker Desktop (PostgreSQL + Redis via Docker Compose) — `docker compose version`
- Git — `git --version`

## Run locally

1. Create your local settings file and set real local values (never commit it):
   ```
   copy .env.example .env
   ```
   Docker Compose and the API both read `.env`. Change `POSTGRES_PASSWORD` and the password in `DATABASE_URL` together.
2. Start PostgreSQL and Redis:
   ```
   docker compose up -d
   ```
   On Windows, ports 5432 and 6379 must be free. If another local Postgres or Redis is running, stop it or change the host port in `docker-compose.yml`.
3. Install dependencies from the repo root:
   ```
   npm install
   ```
4. Apply database migrations (creates only the migration bookkeeping table in this phase):
   ```
   npm run db:migrate
   ```
5. Start the API (port 4000) in one terminal, and the web app (port 3000) in another:
   ```
   npm run dev:api
   npm run dev:web
   ```
6. Open http://localhost:3000 and check the API:
   - http://localhost:4000/health — liveness, always 200 while the process runs
   - http://localhost:4000/ready — 200 when PostgreSQL and Redis respond, 503 otherwise

The API refuses to start if a required setting is missing or invalid (the error names the setting, never its value), and if Redis is unreachable at startup.

## Checks

```
npm run lint
npm run typecheck
npm test
```

## Known limitations (foundation)

- No product features yet: the landing page is a placeholder and its buttons are disabled.
- Real-time (Socket.IO) is installed but not wired; it arrives in the realtime phase.
- Migrations: none beyond the runner's own table; the first real migration arrives with sessions.

## How we build

```
Understand → Requirement → Plan → Approve → Implement → Test → Review → Verify → Commit (human)
```

| Step                                        | Claude Code command           |
| ------------------------------------------- | ----------------------------- |
| Capture a feature as a business requirement | `/requirement <feature-name>` |
| Plan, get approval, implement, and track it | `/execute <feature-name>`     |
| Add scope to a delivered feature            | `/enhance <feature-name>`     |
| Fix a bug (test-first, approval gate)       | `/bug-fix <description>`      |
| Investigate an error from evidence          | `/debug <symptom>`            |
| Fix failing tests                           | `/fix-test <scope>`           |
| Review the diff                             | `/code-review`                |
| Run checks                                  | `/run-tests`                  |
| Ready to commit?                            | `/pre-commit-check`           |
| Understand code                             | `/explain-code <target>`      |

- Requirements: `requirements/<feature>/requirement.md` (business) + `planning-tracking.md` (technical).
- Other docs: `docs/` — see `docs/README.md`.
- Claude Code configuration: `.claude/README.md`.
