---
description: Evidence-first debugging - gather logs, network, and server output before reading code; find the root cause.
argument-hint: "<symptom or error>"
disable-model-invocation: true
---

# /debug $ARGUMENTS

Investigate before fixing. Gather **external evidence before reading source code.**

1. **Reproduce:** exact steps, which side (web / api / socket), every time or intermittent.
2. **Evidence** (only what applies, trimmed to relevant lines):
   - API: server log around the error, the failing request (`curl -s -i http://localhost:<port>/api/...`),
     response body and status.
   - DB: migration status, the relevant rows (read-only queries only).
   - Realtime: which events were emitted/received, room membership, Redis connection errors, reconnect timing.
   - Web: the user can paste browser console + network tab output; ask for it rather than guessing.
   - Recent changes: `git log --oneline -n 10`, `git diff` on suspect files.
   - For noisy evidence gathering, the `debug-helper` agent can collect and summarise it.
3. **Isolate:** narrow to one layer and one function with Grep, then read that code.
4. **Diagnose** with `path:line` evidence. Typical LivePulse causes: missing `{ transaction: t }`, emit before
   commit, missing room authorization, stale client state after reconnect, contract drift between `shared/`
   and its users, env/config mismatch.
5. **Report** root cause, evidence, proposed minimal fix, and the regression test to add. Apply the fix only
   via `/bug-fix` or if the developer asks. If a non-obvious lesson emerged, propose a line for the `learnings` skill.

Never run destructive commands (DB reset, data deletion) while debugging.
