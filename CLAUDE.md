# LivePulse

Live audience engagement **prototype** (polls, Q&A, reactions), inspired by StreamAlive. Web + backend only — no mobile.
Phase 1 (workflow setup) done; no app code yet. Don't start a new phase without explicit approval.

**Code is liability:** write the minimum that meets the requirement. Tests describe business behaviour.

## Non-negotiable
- Stack: `api/` Express + TS + **Sequelize** (no other ORM) + PostgreSQL + Socket.IO with `@socket.io/redis-adapter` ·
  `web/` Next.js (App Router) + React + TS + Tailwind · `shared/` Zod schemas + socket event contracts ·
  Vitest + Supertest · Docker Compose (Postgres, Redis). npm workspaces at the root.
- PostgreSQL is the source of truth. Redis Pub/Sub is not durable: persist, commit, then emit; clients re-fetch
  over HTTP on reconnect.
- Zod-validate all untrusted input (HTTP + socket); authorize on the server, never trust the client.
- Schema changes only via generated migrations with `up` and `down`. No `sync({ force | alter })` outside tests.
- No `any`, `!`, or `@ts-ignore` without a justifying comment. No hardcoded secrets; never read or print `.env`.
- Ask before: new packages/dependencies, paid or external services, stack changes, destructive schema changes,
  deleting files, commit/push/deploy, database resets.
- Never claim a test, build, migration, or runtime check passed unless you ran it and saw it pass.

## Layout (proposed until scaffolded — verify with Glob)
```
api/src/{config,routes,controllers,services,models,validation,middleware,realtime}/  api/migrations/  api/tests/
web/src/{app,components,hooks,lib,realtime}/
shared/src/{schemas,events}/
requirements/<feature>/{requirement.md,planning-tracking.md}   docs/{architecture,setup,guides}/
```
Conventions load automatically from `.claude/rules/` when matching files are read. Patterns with examples live in
skills (`backend-patterns`, `frontend-patterns`, `realtime-patterns`, `testing-patterns`, `integration-data-contracts`).

## Commands
Never invent scripts — read `package.json` `scripts` first (none exist yet). Run from the repo root with
`npm run <script> -w api|web|shared` once workspaces exist.

## Workflow (slash commands in `.claude/commands/`)
- New feature: `/requirement <name>` → `/execute <name>` (plan → approval → build → track). Extend: `/enhance`.
- Bugs: `/bug-fix` (TDD, approval gate) · `/debug` (evidence first) · `/fix-test`.
- Quality: `/code-review` · `/run-tests` · `/pre-commit-check` · `/explain-code`.
- Requirements describe how the app **should** behave (business language). Plans and tracking go in
  `planning-tracking.md`. Other docs go in `docs/<category>/kebab-case.md` — never the repo root.

## Token discipline
- Grep/Glob first; Read only the needed lines. Don't re-read files already in context or just edited.
- Never read `node_modules`, build output, or lockfiles unless required.
- Narrowest check first (one file / `-t` filter), quiet reporters, show failures only.
- Spawn subagents only when a `/execute` plan assigns them or the user asks; pass them exact files and
  the plan excerpt so they don't re-explore.
- Short replies: what changed, commands → results, what's unverified.

## Code style
2-space indent, single quotes, no semicolons (Prettier, once configured). `??` over `||`, `?.` for optional access.
kebab-case files, PascalCase components/models/types, camelCase functions, snake_case DB columns.

## Compact instructions
Keep: current requirement name, approved plan and task status, files changed, failing tests and errors, commands
with results, open decisions. Drop file contents and full logs.
