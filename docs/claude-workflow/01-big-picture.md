# 1. The big picture

## What Claude Code is

Claude Code is a tool you run in a terminal inside a project folder. Once started, Claude can:

- read files in your project,
- create and edit files (after you allow it, or automatically for allowed actions),
- run commands such as `npm test` or `docker compose up`,
- follow instructions that you and the project write down.

It is not a chatbot that only talks. It works on your real files, so the instructions and guard rails matter.

## Why we set up a workflow

Left alone, an AI assistant will often:

- start coding before anyone agreed what to build,
- forget the project's rules from one session to the next,
- report "all tests pass" without running them,
- change things that should not change (a committed database schema, `.env` secrets).

So we wrote the project's rules down in files Claude reads, and we put approval points where mistakes are
expensive. The workflow is the set of those files plus the steps we follow.

## The pieces and how they fit

```
You type /execute foundation
        │
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ Command (.claude/commands/execute.md)  = the recipe           │
 │   loads the requirement, asks for a plan, waits for approval │
 └──────────────────────────────────────────────────────────────┘
        │ uses                         │ spawns
        ▼                              ▼
 Skills (.claude/skills/...)     Agents (.claude/agents/...)
 reference knowledge             helper Claudes, separate context
        │                              │ edit files, run checks
        ▼                              ▼
 Rules (.claude/rules/...)       Hooks + settings.json
 load when matching files        enforced: format on save,
 are read                        ask before risky commands
        │
 Always loaded: CLAUDE.md  +  Memory (notes about you)
```

| Piece | Where it lives | Loaded when | Is it enforced? |
|---|---|---|---|
| `CLAUDE.md` | repo root | every request | No, it is guidance Claude is asked to follow |
| Rules | `.claude/rules/*.md` | when a matching file is read | No, guidance |
| Commands | `.claude/commands/*.md` | only when you type `/name` | Guidance, but some tool limits are enforced |
| Agents | `.claude/agents/*.md` | when a command or you start one | Their tool list and model are enforced |
| Skills | `.claude/skills/<name>/SKILL.md` | when Claude decides it needs them | No, guidance |
| Memory | your personal memory folder | every session (the index file) | No, guidance |
| Settings | `.claude/settings.json` | always | **Yes** |
| Hooks | in `settings.json`, scripts in `.claude/hooks/` | on the matching event | **Yes** |

The key difference: **guidance** is Claude reading and trying to follow a note. **Enforced** means Claude Code
itself blocks or runs something, whatever Claude wants. Use guidance for style and process; use settings and
hooks for things that must never slip.

## Why the context budget matters

Everything Claude loads uses its context window, and every request is billed in tokens. So:

- `CLAUDE.md` is kept short, because it is paid on every request.
- Long reference material lives in skills, which load only when needed.
- Big jobs are handed to helper agents. Each helper starts with a fresh, small context and returns a short
  report, so the main conversation does not fill up with file contents.

## Next

Read [CLAUDE.md](02-claude-md.md) next: it is the first file Claude reads in every session.
