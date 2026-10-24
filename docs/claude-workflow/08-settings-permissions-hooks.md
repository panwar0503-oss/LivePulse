# 8. Settings, permissions and hooks — the enforced part

Everything in the previous pages is *guidance*. This page covers the things Claude Code **enforces** itself.

## Settings files

| File | Who it is for | Committed to git? |
|---|---|---|
| `.claude/settings.json` | The whole team | Yes |
| `.claude/settings.local.json` | You personally (your own approvals) | No (git-ignored) |

Claude Code writes the local file when you approve something ("always allow this command").

## Permissions: allow, ask, deny

Each rule says what Claude may do without asking.

```json
"permissions": {
  "allow": [ "Bash(npm run *)", "Bash(npm test *)", "Bash(docker compose ps *)" ],
  "ask":   [ "Bash(git commit *)", "Bash(npm install *)", "Bash(docker compose down *)" ],
  "deny":  [ "Read(.env)", "Read(**/node_modules/**)", "Bash(npm publish *)" ]
}
```

| Result | Meaning | Example |
|---|---|---|
| **allow** | runs without asking | running tests |
| **ask** | stops and asks you every time | installing packages, committing |
| **deny** | never runs | reading `.env` secret file |

If a command matches more than one rule, **deny beats ask, and ask beats allow**. So `npx sequelize-cli db:drop`
still asks you, and reading `.env` is always refused.

### Why these rules

- **`.env` is denied** because it holds secrets. Claude can read `.env.example` (placeholders) but never the real
  file.
- **Commit and push ask** because only a human should decide what goes into history.
- **Package installs ask** because each new dependency is a decision (security, licence, maintenance). This is
  in our `CLAUDE.md` as well, so it is both guidance and enforced.
- **Destructive database commands ask** because dropping a database cannot be undone.

### Caveat

These are guard rails based on the text of the command. They stop accidents; they are not a security sandbox.

## Hooks: automatic actions on events

A hook runs a script automatically when something happens. Ours is in `settings.json`:

```json
"hooks": {
  "PostToolUse": [
    { "matcher": "Edit|Write",
      "hooks": [ { "type": "command",
                   "command": "bash \"${CLAUDE_PROJECT_DIR}/.claude/hooks/format-on-edit.sh\"" } ] }
  ]
}
```

Read it as: **after Claude edits or writes a file, run `format-on-edit.sh`**.

The script (`.claude/hooks/format-on-edit.sh`) formats just that one file with Prettier, and only for code file
types. It exits quietly if Prettier is not installed yet.

### Why a hook and not a rule

We could write "always format code" in `CLAUDE.md`. But Claude might forget, and formatting would then depend on
its memory. A hook runs every single time, without relying on Claude at all. Use hooks for things that must happen
every time, such as formatting or running a check.

## How to check what is active

Inside Claude Code:

- `/status` shows the project settings in effect.
- `/hooks` shows which hooks are registered.
- `/permissions` shows and lets you change your approvals.

## Summary

| You want Claude to… | Use |
|---|---|
| know a project rule | `CLAUDE.md` (guidance) |
| follow a convention for one kind of file | rule (guidance) |
| follow a long how-to | skill (guidance) |
| *never* do something | `deny` in settings (enforced) |
| *always* do something after an action | hook (enforced) |
| *ask before* something risky | `ask` in settings (enforced) |
