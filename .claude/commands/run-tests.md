---
description: Run the smallest relevant real checks (tests, lint, type-check, build) and report exact results.
argument-hint: "[file, test name, or workspace: api | web | shared]"
disable-model-invocation: true
---

# /run-tests $ARGUMENTS

Default scope: inferred from current changes.

1. Read `scripts` in root and workspace `package.json`. None → report "no checks available" and stop. Use only
   scripts that exist. `node --version` fails → report it.
2. Smallest set first: the specific test file or `-t` filter, quiet reporter (`--reporter=dot`), failures only.
3. Integration/socket tests need Postgres/Redis: check `docker compose ps` only when those tests are in scope.
4. Broaden: workspace suite → lint → type-check → build (if build output is affected).
5. Failure → classify: code defect, environment problem, or test bug. Never edit tests or `.skip` to pass —
   suggest `/fix-test` or `/bug-fix`.
6. Never without approval: dropping/resetting/truncating a DB, `migrate:undo:all`, `docker compose down -v`,
   installing packages.

Report a table — `command | ✔ N passed / ✘ N failed / not run | key failure or blocker` — then the next step.
Quote real output only, trimmed to failures.
