# 3. Rules — conventions that load only when they matter

## What they are

A rule is a short Markdown file in `.claude/rules/`. Each rule has a `paths:` list at the top. The rule loads
**only when Claude reads a file that matches one of those paths**.

Example from `.claude/rules/backend-api.md`:

```markdown
---
paths:
  - "api/src/**/*.ts"
---

# Backend API (Express)
- Layers: route → validate (Zod) → controller → service → model.
- Errors: one error middleware returns { success: false, error: { code, message, requestId } }.
```

## Why they exist

`CLAUDE.md` should stay short, but some conventions only matter for one area. Backend API rules are noise when
Claude is editing a React component. Rules solve this: they are loaded only when the relevant files are opened.

| Rule file | Loads when Claude reads | Holds |
|---|---|---|
| `backend-api.md` | `api/src/**/*.ts` | layers, error shape, authorization |
| `database-sequelize.md` | models and migrations | migration rules, transactions |
| `frontend-react.md` | `web/**` | components, state, safe text rendering |
| `realtime-socket-redis.md` | socket code | rooms, emit-after-commit |
| `security.md` | all code | validation, secrets, cookies, CORS |
| `testing.md` | test files | test layout, no `.skip`, clean-up rules |
| `general-coding.md` | TypeScript files | naming, `unknown` vs `any`, no swallowed errors |

## How it works, step by step

1. Claude opens `api/src/config/env.ts`.
2. Claude Code checks each rule's `paths:`. `backend-api.md` matches `api/src/**/*.ts`, so it loads.
3. Claude now follows that rule while editing.
4. Opening `web/src/app/page.tsx` would load the frontend rule instead.

## How to write one

1. Create `.claude/rules/<topic>.md`.
2. Add `paths:` with globs relative to the repo root (`"api/src/**/*.ts"`).
3. Keep it to the conventions that are easy to get wrong. Link to a skill for long examples.

## Rules vs skills vs CLAUDE.md (quick choice)

- Applies to everything, every time → `CLAUDE.md`.
- Applies to one kind of file → **rule**.
- Long reference material needed for one kind of task → [skill](06-skills.md).

## Important

Rules are guidance. Claude is asked to follow them, but nothing stops it from ignoring one. If something must
never happen (such as reading `.env`), we enforce it with [settings](08-settings-permissions-hooks.md) instead.
