# 2. CLAUDE.md — the always-on project instructions

## What it is

`CLAUDE.md` is a plain Markdown file at the root of the project (`C:\Users\dell\LivePulse\CLAUDE.md`). Claude
Code reads it at the start of every session and includes it in every request. It is the project's "constitution":
the short list of rules that apply to all work.

## Why we have it

Without it, every new session starts from zero. Claude would not know our stack, that Phase 2 needs approval,
that we use Sequelize and not Prisma, or that we never commit on our own. Writing these down once means every
session starts with the same understanding.

## What goes in it (and what does not)

Put in:

- the stack (what we use, and what we must not use),
- non-negotiable rules ("never claim a test passed unless you ran it"),
- what needs approval before doing it ("ask before adding a package"),
- where things live (folder layout, commands, workflow order),
- short style rules (indentation, quotes, naming).

Keep out:

- long explanations (move them to `docs/` or skills),
- details that only apply to one feature (put them in `requirements/<feature>/`),
- anything that changes often (it becomes stale and costs tokens every time).

**Why keep it short:** it is paid on every request. A 2,000-line file would fill a big share of the context
before any work starts.

## What it looks like in our project (excerpt)

```markdown
## Non-negotiable
- Stack: `api/` Express + TS + **Sequelize** (no other ORM) + PostgreSQL ...
- Schema changes only via generated migrations with `up` and `down`.
- Ask before: new packages/dependencies, paid or external services, commit/push/deploy ...
- Never claim a test, build, migration, or runtime check passed unless you ran it and saw it pass.
```

## How to use it

- You edit it by hand when a project rule changes. Claude may also suggest edits; review them.
- If Claude does something against a rule, the fix is usually a clearer line here, not a long lecture in chat.
- Check it loads: start `claude` in the project folder and run `/memory` (it lists the loaded instruction files).

## Example: why one line matters

Our rule says "never claim a test passed unless you ran it". This came from a real moment: a helper agent
reported "11 tests pass" when only 10 existed. Because the rule is written down, every helper and every session
is held to the same standard, and we re-ran the tests ourselves before accepting the result.

## Related

- Lower-level or file-specific conventions: [Rules](03-rules.md).
- Facts Claude learns about you: [Memory](07-memory.md). Use `CLAUDE.md` for project rules, memory for personal
  preferences.
