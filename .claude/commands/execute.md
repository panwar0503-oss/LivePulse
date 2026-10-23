---
description: Plan, get approval, implement, and track a requirement (requirements/<name>/).
argument-hint: "<feature-name>"
disable-model-invocation: true
---

# /execute $ARGUMENTS

Build a confirmed requirement with an approval gate and tracking in `requirements/<name>/planning-tracking.md`.

## 1. Load context (only what's needed)
- Feature name is mandatory; missing → list folders in `requirements/` (excluding `_templates`) and ask.
- Read `requirements/<name>/requirement.md`. Missing or status `clarifying` → run the `/requirement` flow first.
- Load the `implementation-order` skill; load `integration-data-contracts` if the feature crosses DB → API → web.
  Load the layer skills (`backend-patterns`, `frontend-patterns`, `realtime-patterns`, `testing-patterns`) only for
  layers this feature touches.
- Glob/Grep the existing code the feature touches; read only relevant sections.

## 2. Plan
For non-trivial features (3+ files, schema change, auth, or real-time), use the `planner` agent, passing the
requirement path and the files you found. Otherwise plan inline. The plan must include:
- Architecture, contracts (HTTP + socket), files to create/modify with risk, impact analysis (breaking changes,
  migrations/rollback, concurrency, security, testing).
- Ordered tasks following `implementation-order`, each with **complexity** and **executor**:
  - **LOW** (boilerplate, renames, config, types) → `executor-low`
  - **MEDIUM** (standard CRUD, tests for existing code, simple components) → `executor-medium`
  - **HIGH** (auth, authorization, transactions/concurrency, migrations design, socket rooms) → `executor-high`
  - Tiny tasks (< ~20 lines) → `inline` (cheaper than starting an agent)
- Write it to `requirements/<name>/planning-tracking.md` from the template; set requirement status `planning`.

## 3. Approval gate
Present a short summary (tasks table + risks). **Stop and wait for explicit approval.** Any new dependency, paid
service, or destructive migration must be called out for separate approval.

## 4. Execute (after approval)
- Set requirement status `in_progress`.
- Run tasks in order. Group consecutive tasks for the same executor into one agent call; give the agent the exact
  task rows, file paths, contracts, and acceptance criteria so it doesn't re-explore. Do `inline` tasks yourself.
- After each task (or group): verify (targeted tests / type-check), then update the task row status and add one
  change-log line. Don't update the files continuously.
- An executor fails or the result is wrong → take over inline, note it in the change log.
- Issue found mid-way that changes the plan → add `Issues & updates`, write `Plan (v2)/Tasks (v2)` (keep v1),
  and get approval again.

## 5. Finish
- Run `/run-tests`-style checks for the affected workspaces. Self-review `git diff`.
- Update requirement status `completed` (or `failed` with reason) and its change log; update `docs/` only if
  architecture or setup changed.
- Report briefly: success criteria ✔/✘ · files changed · commands → results · not verified · risks. Don't commit.
