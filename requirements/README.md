# Requirements

Every feature gets a folder **before** code is written:

```
requirements/
├── _templates/                     templates — copy, don't edit in place
└── <feature-name>/                 kebab-case, e.g. live-polls
    ├── requirement.md              business language: what, who, behaviours, flows, scope, success criteria
    ├── planning-tracking.md        technical: plan versions, files, tasks + status, change log
    └── enhancements/<name>/        later scope increments, same two files
```

- Create with `/requirement <feature-name>`, build with `/execute <feature-name>`, extend with `/enhance`.
- `requirement.md` describes how the app **should** behave — no code, file paths, or bug logs. When a bug reveals
  missing or ambiguous behaviour, `/bug-fix` clarifies the requirement; git history records the bug.
- Status flow: `clarifying → planning → approved → in_progress → completed | failed`.
