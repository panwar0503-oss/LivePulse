---
description: Clarify a feature and write requirements/<name>/requirement.md in business language. No code.
argument-hint: "<feature-name> [raw description]"
disable-model-invocation: true
disallowed-tools: Edit, NotebookEdit
---

# /requirement $ARGUMENTS

Turn a raw feature idea into a confirmed business requirement. **No application code, no plan.**

1. **Name.** The first argument is the kebab-case feature name (e.g. `live-polls`). Missing → ask for it; never
   invent one. If `requirements/<name>/` already exists, stop and suggest `/enhance <name>`.
2. **Raw request.** Use the rest of the arguments verbatim; if empty, ask for the description.
3. **Clarify.** Load the `requirement-clarifier` skill and follow it: ask only genuinely ambiguous questions
   (batch them in one message), propose assumptions, define in/out of scope, risks, success criteria.
   Keep LivePulse context in mind: host vs participant roles, live updates, reconnects, duplicate submissions.
4. **Confirm.** Present the clarification report and **wait** for the developer to confirm or revise.
5. **Write** `requirements/<name>/requirement.md` from `requirements/_templates/requirement.md`
   (status `planning`, change-log entry dated today). Business language only: no code, file paths, components.
   Omit template sections that don't apply.
6. **Report** the file path and the next step: `/execute <name>`.
