# LivePulse

Interactive live audience engagement prototype (polls, Q&A, reactions) — web frontend + backend.

| Part | Stack | Status |
|---|---|---|
| `api/` | Express, TypeScript, Sequelize, PostgreSQL, Socket.IO + Redis adapter, Zod | not scaffolded |
| `web/` | Next.js, React, TypeScript, Tailwind CSS | not scaffolded |
| `shared/` | Zod schemas and Socket.IO event contracts used by both | not scaffolded |

## Prerequisites (install before Phase 2)

- Node.js LTS (includes npm) — `node --version`
- Docker Desktop (PostgreSQL + Redis via Docker Compose) — `docker compose version`
- Git — `git --version`

Run scripts will be documented here once `package.json` files exist.

## How we build

```
Understand → Requirement → Plan → Approve → Implement → Test → Review → Verify → Commit (human)
```

| Step | Claude Code command |
|---|---|
| Capture a feature as a business requirement | `/requirement <feature-name>` |
| Plan, get approval, implement, and track it | `/execute <feature-name>` |
| Add scope to a delivered feature | `/enhance <feature-name>` |
| Fix a bug (test-first, approval gate) | `/bug-fix <description>` |
| Investigate an error from evidence | `/debug <symptom>` |
| Fix failing tests | `/fix-test <scope>` |
| Review the diff | `/code-review` |
| Run checks | `/run-tests` |
| Ready to commit? | `/pre-commit-check` |
| Understand code | `/explain-code <target>` |

- Requirements: `requirements/<feature>/requirement.md` (business) + `planning-tracking.md` (technical).
- Other docs: `docs/` — see `docs/README.md`.
- Claude Code configuration: `.claude/README.md`.
