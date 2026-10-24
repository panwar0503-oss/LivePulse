# 6. Skills — reference knowledge loaded on demand

## What they are

A skill is a folder in `.claude/skills/<name>/` with a file called `SKILL.md`. It holds reference material:
patterns, examples, checklists. Example, the top of `.claude/skills/backend-patterns/SKILL.md`:

```markdown
---
name: backend-patterns
description: LivePulse Express + Sequelize code patterns - route, validation, controller, service with transaction,
  error handling. Use when writing api/ code.
---

# Backend patterns (Express + TypeScript + Sequelize)

## Request flow
route → authenticate → validate (Zod) → controller → service (authz + transaction) → model → DTO
```

## Why they exist

Some knowledge is long: how to write a route, how to write a transaction, how to write a socket handler. Putting it
all in `CLAUDE.md` would waste tokens on every request. A skill holds it in a file that is read only when the
job needs it.

## How Claude decides to use one

1. At the start, Claude sees only each skill's **name and description** (a short list).
2. When the task matches a description, Claude loads the full `SKILL.md`.
3. Commands can also tell Claude which skills to load. For example `/execute` says "load `implementation-order`"
   before planning.

**Why the description matters:** it is the only part Claude reads before deciding. A vague description means the
skill is never loaded, or loaded for the wrong job. Write it as "what it is + when to use it".

## Our skills

| Skill | Use it when |
|---|---|
| `implementation-order` | Building a feature: the order of layers (contract → migration → model → service → API → socket → web) |
| `integration-data-contracts` | A field crosses database, API, shared schema and web |
| `backend-patterns` | Writing `api/` code |
| `frontend-patterns` | Writing `web/` code |
| `realtime-patterns` | Writing Socket.IO code |
| `testing-patterns` | Writing tests |
| `requirement-clarifier` | Turning a vague idea into a clear requirement (used by `/requirement`) |

## Skill vs rule vs command (quick choice)

- A **rule** is a short convention for one kind of file, loaded automatically.
- A **skill** is a longer how-to, loaded when the task calls for it.
- A **command** is a workflow you start yourself.

## Example

When we planned the foundation feature, `/execute` asked for the `implementation-order` skill. That skill told the
planner to build in this order: shared schemas, database setup, API core, database and Redis connections, health
endpoints, tests, web shell, then root scripts. The plan followed that order, so each step could be tested before
the next one depended on it.
