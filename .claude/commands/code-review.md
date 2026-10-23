---
description: Read-only severity-ranked review of the current diff (or given files/range) for correctness, security, data integrity, and tests.
argument-hint: "[files, commit range, or focus]"
disable-model-invocation: true
disallowed-tools: Edit, Write, NotebookEdit
---

# /code-review $ARGUMENTS

Read-only (default target: uncommitted changes). Offer fixes after the report; apply only if asked.

1. `git status`, `git diff --stat`, then `git diff` / `git diff --staged` (or the given range). Read changed hunks
   plus only the context needed. Find the related `requirements/<feature>/requirement.md` and check the change
   matches its behaviours and scope.
2. Check: correctness (edge cases, async errors, types) · security (Zod, server authorization, cross-session
   exposure, secrets, logging) · data integrity (model ↔ migration, constraints, `{ transaction: t }`, races) ·
   realtime (room authz, payload validation, emit after commit, reconnect/duplicates) · performance (N+1,
   unbounded queries/broadcasts) · UI states + accessibility · reuse of existing components/helpers instead of
   duplicates · scope creep, debug code · tests in business language covering failure paths.
3. Report by severity (Critical / High / Medium / Low; omit empty), one or two lines each:
   `[Verified|Potential] path:line — issue. Impact: … Fix: …`
4. No findings → "No findings identified" + what wasn't reviewed. Never imply the code is defect-free.

For an independent or deeper pass, the user can ask for the `code-reviewer` or `security-reviewer` agent.
