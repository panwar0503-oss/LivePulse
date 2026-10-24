# 9. Worked example — the `foundation` feature, start to finish

This is what really happened when we built the project skeleton. It uses every piece from the previous pages.

## Step 1 — Write the requirement (`/requirement`)

You typed:

```
/requirement foundation Set up the LivePulse project skeleton ...
```

What the command did, in order:

1. Checked the name was valid and the folder did not already exist.
2. Asked **four questions in one message** because they were genuinely open:
   migration tool, Redis policy, how far the web app goes, which packages to approve.
3. You answered with the recommended options.
4. Wrote `requirements/foundation/requirement.md` from the template.

**Why business language:** the requirement says what the app should do ("a developer starts the local services
with one command"), not which library to use. Technical choices come later, in the plan.

**Where the questions came from:** the `requirement-clarifier` skill. The command told Claude to load it.

## Step 2 — Make the plan (`/execute`, first half)

```
/execute foundation
```

1. The command checked the requirement existed and was not still `clarifying`.
2. It loaded the `implementation-order` skill (the build order).
3. Because the feature touches many files, it started the **planner** agent (read-only, opus model).
4. The planner returned a plan with 10 tasks, each with a complexity and an executor.
5. The main session wrote the plan into `requirements/foundation/planning-tracking.md`.
6. **It stopped and asked for approval**, listing the open decisions.

**Why stop here:** a plan costs little to change; building the wrong thing costs a lot. The approval gate is the
cheapest place to catch a bad decision.

The open decisions were real: the planner found that `docs/04` and `.claude/rules/backend-api.md` disagreed on the
error response shape. The workflow surfaced it before any code existed.

## Step 3 — Approval

You answered the decisions (error shape, extra packages, versions, zero migrations). The main session recorded
them in the tracking file, and fixed the rule file so it agreed with the docs.

**Why the packages needed a separate yes:** `CLAUDE.md` says "ask before adding dependencies", and the settings
ask before `npm install`. Both are guidance and enforcement working together.

## Step 4 — Build (the executor agents)

The tasks were grouped by executor. Consecutive tasks with the same executor became one agent call:

| Group | Tasks | Executor | Why this executor |
|---|---|---|---|
| A | 1–3 | low (haiku) | config files and a schema, nothing risky |
| B | 4 | medium (sonnet) | env validation with tests |
| C | 5–6 | high (opus) | error handling, startup and shutdown |
| D | 7–8 | medium | readiness endpoints and tests |
| E | 9 | medium | Next.js shell |
| F | 10 | inline (main session) | small root scripts and README |

Each agent got the exact task rows, the files to read first, the contract, and the commands to verify with.

## Step 5 — Verify (the part you must not skip)

Each report was treated as a claim. The main session ran the checks itself:

```
npm run lint        → exit 0
npm run typecheck   → exit 0
npm test            → shared 10 pass · api 22 pass + 2 skipped · web 2 pass
npm run db:migrate  → exit 0
curl /health        → 200
curl /ready         → 200, then 503 {"redis":"down"} when Redis was stopped, then 200 again
```

**Real problems found this way:**

- Node and Docker were not installed at first, so nothing could run. We stopped and asked, rather than writing
  more unverified code.
- The API ignored the `.env` file the README told you to create. Found while checking the README steps, fixed
  with `process.loadEnvFile`.
- Lint failed on three small things (an unused variable, Node globals in a `.cjs` file). Fixed them without
  weakening any test.

## Step 6 — Track and report

- Each task row got a status (`verified`, `verified (partial)`, ...). Partial means "I checked this, but not
  everything in the task".
- Each change got a line in the change log.
- The requirement status changed to `completed`, with the gaps written down (graceful shutdown on Ctrl+C was not
  verified).
- Nothing was committed. You review `git status` and commit yourself.

## What to take from this

| Stage | Piece that did the work |
|---|---|
| Understanding the goal | `/requirement` + `requirement-clarifier` skill |
| Planning | `/execute` + `planner` agent + `implementation-order` skill |
| Approval | the command stopping and waiting |
| Building | `executor-*` agents with exact instructions |
| Safety | `settings.json` (ask before install and commit, deny `.env`) |
| Formatting | the format-on-edit hook |
| Truth | the main session re-running every check |

## Try it yourself

1. Read `requirements/foundation/requirement.md` (what we agreed).
2. Read `requirements/foundation/planning-tracking.md` (what we planned, decided and verified).
3. Run `npm run lint && npm run typecheck && npm test` and compare with the numbers above.
