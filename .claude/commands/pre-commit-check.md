---
description: Check whether changes are ready for a human commit - secrets, debug code, scope, tests, requirement/docs, checks. Never commits.
disable-model-invocation: true
disallowed-tools: Edit, Write, NotebookEdit
---

# /pre-commit-check

Read-only. Never run `git add`, `commit`, `push`, or `stash`.

1. `git status`, `git diff --stat`, then `git diff` / `git diff --staged`. Confirm untracked files belong.
2. Secrets: non-example `.env` files, keys, tokens, passwords, credentialed URLs. Report file + line, **never the
   value**. Confirm `.gitignore` covers `.env*`, `node_modules/`, `.claude/settings.local.json`.
3. Leftovers (Grep changed files): `console.log`, `debugger`, `.only`/`.skip`, commented-out code, bare TODOs.
4. Scope: unrelated changes, formatting churn, lockfile changes without dependency changes.
5. Tests cover changed behaviour; migrations have `up`/`down` and match models.
6. Tracking: related `requirements/<feature>/` status, task table, and change log are current.
7. Run available lint, type-check, and relevant tests (as `/run-tests`); skip with a reason if absent.
8. Docs / `.env.example` / `CLAUDE.md` / `README.md` need updates?

Report: **Ready / Not ready** · blockers · warnings · checks → results · suggested Conventional Commit message
(`feat(api): …`, `fix(web): …`).
