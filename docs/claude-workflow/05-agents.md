# 5. Agents — helper Claudes with their own context

## What they are

An agent (also called a subagent) is a second Claude started by the main session to do one job. It has:

- its own **context window** (it starts fresh, and does not see the main conversation),
- its own **tools** (the list of things it may do, for example read files, or edit files),
- its own **model** (a bigger model for hard thinking, a smaller one for simple typing),
- a **turn limit** (`maxTurns`) so it cannot loop forever.

Agents are defined in `.claude/agents/<name>.md`. Example from `.claude/agents/planner.md`:

```markdown
---
name: planner
description: Read-only planner for non-trivial LivePulse features. Used by /execute.
tools: Read, Grep, Glob, Bash
model: opus
maxTurns: 30
---

You plan LivePulse features. Read-only: never create or edit files.
...
```

## Why we use them

1. **Keep the main conversation small.** A helper reads 20 files and returns a 200-word report. The main
   conversation never holds all 20 files.
2. **Right model for the job.** Planning and hard bugs use the strongest model. Simple boilerplate uses a
   cheaper, faster model. This saves money without losing quality where it matters.
3. **Safety by limits.** The planner can only read. An executor can edit, but only for its own kind of task.
4. **Parallel-friendly in principle.** Independent jobs could run side by side. We ran ours one at a time,
   because the API and web installs both change the same `package-lock.json`, and two installs at once would
   fight over it.

## Our agents

| Agent | Model | Can | Used for |
|---|---|---|---|
| `planner` | opus | read only | Designs the plan for non-trivial features |
| `executor-low` | haiku | edit | Simple tasks: config, boilerplate, types |
| `executor-medium` | sonnet | edit | Standard CRUD, components, tests |
| `executor-high` | opus | edit | Risky work: auth, transactions, migrations, sockets |
| `debugger` | opus | edit | Hard bugs, on request |
| `debug-helper` | haiku | read only | Cheap evidence gathering |
| `code-reviewer` | sonnet | read only | Reviews, on request |
| `security-reviewer` | sonnet | read only | Security review, on request |
| `test-engineer` | sonnet | edit | Writing tests, on request |

## Why executors are tiered

The plan gives every task a complexity level and an executor:

- **LOW** (config, renames) → `executor-low`
- **MEDIUM** (CRUD, tests) → `executor-medium`
- **HIGH** (auth, transactions, migrations, sockets) → `executor-high`
- **Tiny** (under about 20 lines) → done inline by the main session, because starting an agent costs more than
  the task itself.

## How the main session uses them (the important part)

The main session must hand over **exact** information, so the agent does not waste time searching:

- the task rows from the plan,
- the file paths,
- the contract (what the endpoint or event must look like),
- how to check the work (the commands to run).

Then it asks the agent for a short report.

## Example from the foundation feature

We built Tasks 4–9 this way. The main session wrote a prompt such as:

> Build task 7 and 8 … Read first: `api/src/app.ts`, `readiness.service.ts` … Error shape: `{ success: false,
> error: { code, message, details?, requestId } }` … VERIFY: `npm run typecheck -w api` exit code …

## Important: check the report

An agent's report is a claim, not proof. In this project:

- A helper said "11 tests" when the file had 10. We counted.
- A helper's Node/Docker check was right: they were missing until we installed them.

So the main session runs the real commands again and writes down the exact results. Agents do the work; you (and
the main session) do the verifying.

## Things an agent cannot do

- Coordinate other agents. In our workflow the main session starts every agent and collects every report, so
  the agents never hand work to each other.
- Approve something for you. If it hits an "ask" permission, the prompt goes to you.
- See files you did not point it to, unless it searches.
