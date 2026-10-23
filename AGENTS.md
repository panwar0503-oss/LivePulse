# AGENTS.md

For coding agents other than Claude Code (Codex, OpenCode, Cursor, etc.). Claude Code reads `CLAUDE.md` instead and
ignores this file while `CLAUDE.md` exists.

**The single source of truth is [`CLAUDE.md`](CLAUDE.md)** — read it first; everything there applies to you.

Then, depending on the task, read:

| Task | Read |
|---|---|
| Any code change | Matching file in `.claude/rules/` (backend-api, database-sequelize, frontend-react, realtime-socket-redis, testing, security, general-coding) |
| New feature | `.claude/commands/requirement.md`, `.claude/commands/execute.md`, `.claude/skills/implementation-order/SKILL.md` |
| Backend / DB | `.claude/skills/backend-patterns/SKILL.md` |
| Frontend | `.claude/skills/frontend-patterns/SKILL.md` |
| Real-time | `.claude/skills/realtime-patterns/SKILL.md` |
| Cross-layer fields/contracts | `.claude/skills/integration-data-contracts/SKILL.md` |
| Tests | `.claude/skills/testing-patterns/SKILL.md` |
| Bug | `.claude/commands/bug-fix.md`, `.claude/skills/learnings/SKILL.md` |

Workflow skills and commands are shared from `.claude/` on purpose — there is no `.agents/skills` copy to drift.
