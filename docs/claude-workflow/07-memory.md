# 7. Memory — what Claude remembers about you

## What it is

Claude Code can keep **auto-memory**: small notes that persist across sessions. They live in a folder on your
computer, not in the project repository:

```
C:\Users\dell\.claude\projects\C--Users-dell-LivePulse\memory\
    MEMORY.md              ← index: one line per memory (loaded every session)
    user-profile.md        ← who you are and how you like to work
    livepulse-phases.md    ← project facts that are not in the code
```

Each memory file has a short header:

```markdown
---
name: user-profile
description: User's background and how they want AI-assisted development to work
metadata:
  type: user
---

Works in phases and wants an explicit approval gate before each new phase.
```

## Why it exists

Some facts are about you or the project's history, not the code. For example:

- "This person has about five years of Node.js experience, so explain Next.js and Socket.IO, not Express basics."
- "Phase 2 must not start until the owner approves it."

Without memory, you would repeat these in every new session.

## The four types we use

| Type | Stores | Example |
|---|---|---|
| `user` | who you are, your skill level | "knows Node/Express well" |
| `feedback` | how you want Claude to work, including corrections | "ask before adding packages" |
| `project` | goals and facts not visible in the code | "demo is for CTOs; AI must be human-approved" |
| `reference` | where to find things outside the repo | "bug board is at ..." |

## What NOT to store

- Anything the code or git history already shows (file names, past fixes).
- Secrets, passwords, tokens.
- Things that only matter for today's conversation.

## Memory vs CLAUDE.md

- **CLAUDE.md** = rules for the *project*, shared with everyone who works on it, committed to git.
- **Memory** = notes about *you* and the project's history, personal to your computer, not committed.

## How to see or change it

- Ask Claude "what do you remember about me?" or open the folder above in an editor.
- Edit or delete a file if it is wrong. Claude treats memory as a hint, so check facts that matter against the
  code.
