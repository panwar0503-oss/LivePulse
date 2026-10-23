---
description: Add a scope increment to an existing requirement as requirements/<parent>/enhancements/<name>/, then plan and build it.
argument-hint: "<parent-feature> <enhancement-name> [description]"
disable-model-invocation: true
---

# /enhance $ARGUMENTS

Extend a delivered requirement without losing its history.

```
requirements/<parent>/
├── requirement.md            ← add a row to its "Enhancements" table + change-log line
├── planning-tracking.md      ← untouched
└── enhancements/<name>/
    ├── requirement.md
    └── planning-tracking.md
```

1. **Parent.** Missing → list `requirements/*/` (exclude `_templates`) and ask. Read the parent `requirement.md`
   and skim its `planning-tracking.md` (plan + files sections only).
2. **Name + description.** Enhancement name is mandatory, kebab-case. Target folder exists → ask for another name.
3. **Clarify** with the `requirement-clarifier` skill, anchored on the parent: what still applies, what changes,
   inherited vs new assumptions, and regression risk to delivered behaviour. Present and **wait for confirmation**.
4. **Write** the enhancement `requirement.md` (template, with **Parent** link) and update the parent's
   Enhancements table and change log.
5. **Plan, approve, execute, finish** exactly as `/execute` steps 2–5, but against the enhancement folder. Include
   regression tests for the parent's key behaviours that the change touches.
