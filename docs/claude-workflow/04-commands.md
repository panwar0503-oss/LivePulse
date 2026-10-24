# 4. Commands — the `/slash` workflows you type

## What they are

A command is a Markdown file in `.claude/commands/`. Its file name becomes the command. For example
`.claude/commands/execute.md` becomes `/execute`.

The file has two parts:

1. **Header** (front matter between `---` lines): settings for the command.
2. **Body**: a numbered recipe Claude follows when you run it.

Example, trimmed from `.claude/commands/requirement.md`:

```markdown
---
description: Clarify a feature and write requirements/<name>/requirement.md in business language. No code.
argument-hint: "<feature-name> [raw description]"
disable-model-invocation: true
disallowed-tools: Edit, NotebookEdit
---

# /requirement $ARGUMENTS

1. **Name.** The first argument is the kebab-case feature name. Missing → ask for it.
2. **Clarify.** Ask only genuinely ambiguous questions, batched in one message.
3. **Confirm.** Present the report and wait for the developer to confirm.
4. **Write** requirements/<name>/requirement.md from the template.
```

- `$ARGUMENTS` is replaced with whatever you typed after the command name. Typing `/requirement foundation Set up
  the skeleton` makes `$ARGUMENTS` equal `foundation Set up the skeleton`.
- `disable-model-invocation: true` means Claude cannot start this command by itself. Only you can. This stops it
  from starting a big workflow unasked.
- `disallowed-tools: Edit` is enforced by Claude Code. `/requirement` is not allowed to edit files, only write
  the requirement file, so it cannot quietly change code.

## Why we use commands

A command is a repeatable recipe. Without them, each feature starts with a different instruction and steps get
skipped (for example, planning before building). A command makes the order the same every time.

## The commands we have

| Command | What it does | Changes files? |
|---|---|---|
| `/requirement <name>` | Turns your idea into a business requirement | Only the requirement file |
| `/execute <name>` | Plans, asks for approval, builds, tracks | Yes |
| `/enhance <parent> <name>` | Adds a new scope to a finished feature | Yes |
| `/bug-fix <symptom>` | Writes a failing test first, then fixes | Yes, after approval |
| `/debug <symptom>` | Gathers evidence and finds the cause | No |
| `/fix-test <scope>` | Decides if the test or the code is wrong, then fixes | Yes, after approval |
| `/code-review` | Reviews your current changes | No |
| `/run-tests` | Runs the right tests and reports exact results | No |
| `/pre-commit-check` | Checks secrets, leftovers and tests before you commit | No (never commits) |
| `/explain-code <thing>` | Explains how a piece of code works | No |

## How to use one

1. Start Claude Code in the project folder: `claude`.
2. Type the command with its argument, for example `/requirement live-polls`.
3. Answer the questions it asks. Read what it presents before saying yes.

## Example flow

```
You:    /requirement foundation  Set up the project skeleton ...
Claude: asks 4 questions in one message (migration tool? Redis policy? ...)
You:    answer them
Claude: writes requirements/foundation/requirement.md (status: planning)
You:    /execute foundation
Claude: writes the plan into planning-tracking.md and STOPS
You:    approve (or ask for changes)
Claude: builds the tasks, runs the checks, updates the tracking file
```

## Good to know

- Commands are guidance too: Claude follows the recipe, but the structure (what it asks, when it stops) is what
  makes the workflow reliable.
- `disallowed-tools` and `disable-model-invocation` are the two settings Claude Code enforces.
- To add a command: create `.claude/commands/<name>.md` with a `description`, `argument-hint`, and
  `disable-model-invocation: true`.
