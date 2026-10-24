# How the Claude Code workflow in this project works

This folder explains, in plain English, how we use Claude Code to build LivePulse. Read them in order the
first time. Each page answers three questions: **what** it is, **why** it exists, and **how** we use it here.

| # | Page | What it covers |
|---|---|---|
| 1 | [Big picture](01-big-picture.md) | What Claude Code is and how all the pieces fit together |
| 2 | [CLAUDE.md](02-claude-md.md) | The always-on project instructions |
| 3 | [Rules](03-rules.md) | Coding conventions that load only for matching files |
| 4 | [Commands](04-commands.md) | The `/slash` commands you type (`/requirement`, `/execute`, ...) |
| 5 | [Agents](05-agents.md) | Helper Claudes with their own context and limits |
| 6 | [Skills](06-skills.md) | Reference knowledge Claude loads only when needed |
| 7 | [Memory](07-memory.md) | Notes Claude keeps about you between sessions |
| 8 | [Settings, permissions and hooks](08-settings-permissions-hooks.md) | What is allowed, what asks you first, and automatic actions |
| 9 | [Worked example: the foundation feature](09-worked-example.md) | One real feature from start to finish |

## Quick glossary

- **Claude Code** — a command-line tool from Anthropic. It runs Claude in your terminal, reads and edits your
  files, and runs commands for you.
- **Session** — one conversation with Claude Code, from when you start it until you close it.
- **Context window** — the amount of text Claude can hold in mind at once. Everything loaded into a session
  uses some of it, so we keep always-loaded files short.
- **Token** — a small piece of text (roughly ¾ of a word). Claude reads and writes in tokens, and cost and
  limits are counted in tokens.
- **Prompt** — the text Claude receives for one step. Instructions, files, and your message all become part
  of it.
- **Approval gate** — a point where the workflow stops and waits for you to say "yes" before doing risky work.
- **Subagent** — a second Claude started by the main session to do one job, in its own separate context.

## The one-minute version

1. You describe a feature in business words → `/requirement` writes it down.
2. `/execute` makes a technical plan → **you approve it**.
3. Small helper Claudes build the approved tasks in order.
4. Claude runs the real tests and reports what actually passed.
5. You read the result and commit it yourself.

Claude never commits, pushes, or deletes things without asking, and it must not say a test passed unless it
actually ran it.
