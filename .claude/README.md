# LivePulse Claude Code workflow

Adapted from `../self-claude-project` (same ideas: requirements folders, approval gates, tiered executors,
auto-format) but rewritten for Claude Code's real file formats and the LivePulse stack. Web + backend only — the
reference's mobile, Figma, Maestro, and Bitbucket pieces were intentionally not carried over.

## Layout

```
CLAUDE.md                  always-loaded project rules (keep it short — paid on every request)
AGENTS.md                  pointer for other AI tools; Claude Code ignores it while CLAUDE.md exists
requirements/              one folder per feature: requirement.md (business) + planning-tracking.md (technical)
docs/                      architecture / setup / guides / phases
.claude/
  settings.json            shared permissions + hooks (committed)
  settings.local.json      your personal approvals (gitignored, written by Claude Code)
  commands/*.md            slash commands = the workflows you run
  agents/*.md              subagents (planner, tiered executors, debugger, reviewers)
  skills/<name>/SKILL.md   knowledge Claude loads on demand (patterns, contracts, clarifier)
  rules/*.md               short conventions auto-loaded when matching files are read
  hooks/format-on-edit.sh  auto-format hook (replaces the reference's OpenCode plugin)
```

## Mechanisms — what is guidance vs enforced

| Mechanism | Loads | Enforced? |
|---|---|---|
| `CLAUDE.md` | every request | guidance |
| Rules | when Claude reads a file matching `paths` | guidance |
| Skills | description listed; body when Claude or a command loads it | guidance |
| Commands | only when you type `/name` (all set `disable-model-invocation: true`) | guidance; `disallowed-tools` is enforced |
| Agents | description listed; body only when spawned | tool list, model, `maxTurns` enforced |
| `settings.json` permissions | always | **enforced by Claude Code** |
| Hooks | on the event | **enforced by Claude Code** |

## Slash commands

| Command | Purpose | Edits? |
|---|---|---|
| `/requirement <name> [desc]` | clarify → `requirements/<name>/requirement.md` | docs only |
| `/execute <name>` | plan (planner) → **approval** → build with tiered executors → track → verify | yes |
| `/enhance <parent> <name>` | scope increment in `requirements/<parent>/enhancements/<name>/` | yes |
| `/bug-fix <symptom>` | analyse → **approval** → clarify requirement → failing test → minimal fix | yes |
| `/debug <symptom>` | evidence first, root cause, proposed fix | no (unless asked) |
| `/fix-test <scope>` | test wrong / code wrong / requirement ambiguous → **approval** → fix | yes |
| `/code-review [target]` | severity-ranked review of the diff | no |
| `/run-tests [scope]` | smallest relevant real checks, exact results | no |
| `/pre-commit-check` | secrets, leftovers, scope, tests, tracking → ready? | no; never commits |
| `/explain-code <target>` | flow, data, errors, trade-offs | no |

`/code-review` replaces the bundled command of the same name in this repo; the bundled one is still `/review`.

## Agents (tiered, like the reference)

| Agent | Model | Tools | Used by |
|---|---|---|---|
| `planner` | opus | read-only | `/execute` for non-trivial features |
| `executor-low` | haiku | edit | LOW tasks: boilerplate, config, types |
| `executor-medium` | sonnet | edit | MEDIUM tasks: CRUD, components, tests |
| `executor-high` | opus | edit | HIGH tasks: authz, transactions, migrations, sockets |
| `debugger` | opus | edit | hard bugs (`/debug`, on request) |
| `debug-helper` | haiku | read-only | cheap evidence gathering |
| `code-reviewer` | sonnet | read-only | on request |
| `security-reviewer` | sonnet | read-only | on request |
| `test-engineer` | sonnet | edit | on request |

Tasks under ~20 lines run inline — starting an agent costs more than the task. `/execute` batches consecutive
tasks for the same executor into one call and passes exact files and contracts so agents don't re-explore.

## Skills (knowledge)

`requirement-clarifier`, `implementation-order`, `integration-data-contracts`, `backend-patterns`,
`frontend-patterns`, `realtime-patterns`, `testing-patterns`, `learnings`. Commands tell Claude which to load.

## Settings

**allow** (no prompt): `npm run *`, `npm test`, `npx vitest|tsc|prettier|eslint|sequelize-cli *`,
`docker compose up|ps|logs`, `curl -s http://localhost*`, read-only git.
**ask** (prompt every time, even in auto mode): commit/push/reset/clean/rebase/restore, `rm`, package
install/update, `npx create-*` scaffolders, `db:drop|reset|migrate:undo|seed:undo`, `docker compose down`,
volume removal, reading lockfiles, editing `.env`.
**deny**: reading `.env*` (except `.env.example`), keys, `node_modules`/build output; force push; `npm publish`.
`bashOutputMaxChars: 15000` keeps long outputs out of context.

Precedence is deny > ask > allow, so e.g. `npx sequelize-cli db:drop` still prompts. Rules match the command text;
they are guard rails, not a sandbox.

## Hook: format on edit

`PostToolUse` on `Edit|Write` runs `.claude/hooks/format-on-edit.sh` (Git Bash on Windows). It formats only the
file just edited, only `.ts/.tsx/.js/.jsx/.mjs/.cjs/.json/.css`, only with the repo's own
`node_modules/.bin/prettier`, and exits silently when Node or Prettier is missing — so it is safe today and
starts working once Phase 2 installs Prettier. The reference's hook hardcoded a Linux path; this one uses
`${CLAUDE_PROJECT_DIR}`.

## Not carried over from the reference (and why)

- `.agents/skills/` duplicate — it had drifted from `.claude/skills` (16 files differed). `AGENTS.md` points other
  tools at `.claude/` instead.
- `.claude/plugins/auto-format.ts` — OpenCode plugin format; Claude Code uses the hook above.
- OpenCode agent frontmatter (`mode`, `openrouter/...` models, `temperature`, tool maps) — invalid in Claude
  Code; rewritten with `name`, `tools`, `model`.
- `.mcp.json` (Playwright, Chrome DevTools, mobile MCP) — external integrations need your approval; add later if
  wanted for UI debugging.
- Mobile/Flutter/React Native/Maestro/Figma/Bitbucket commands and skills — out of scope.
- Broad allows (`npx *`, `docker *`, `curl *`, `cat *`) — narrowed to the commands this project needs.

## Extending

- Command: `.claude/commands/<name>.md` with `description`, `argument-hint`, `disable-model-invocation: true`.
- Skill: `.claude/skills/<name>/SKILL.md` with `name` (= folder) and a one-line `description`.
- Agent: `.claude/agents/<name>.md` with `name`, `description`, narrowest `tools`, `model`, `maxTurns`.
- Rule: `.claude/rules/<topic>.md` with `paths:` globs relative to the repo root.

## Verify after changes

New session in the repo root → `/` lists commands → `/agents` lists agents → `/status` shows project settings →
`/hooks` shows the PostToolUse hook → `claude doctor` reports no rejected entries.

## Commit vs local

Commit everything except `.claude/settings.local.json`, `CLAUDE.local.md`, `.env*` (but do commit `.env.example`),
keys, `node_modules/`, build output — all covered by `.gitignore`.
