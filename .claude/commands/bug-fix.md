---
description: Test-first bug fix - analyse root cause, get approval, clarify the requirement, failing test, minimal fix, verify.
argument-hint: "<symptom / error / failing behaviour> [requirements/<feature>]"
disable-model-invocation: true
---

# /bug-fix $ARGUMENTS

## Phase 0 — Requirement
Find the feature's `requirements/<feature>/requirement.md` (from the arguments, or by matching the symptom to a
folder). None fits → ask the developer which requirement covers it, or confirm there is none.

## Phase 1 — Analyse
1. Capture expected vs actual, exact error/stack trace, and trigger steps. Missing essentials → ask one question.
2. Locate with Grep from the error text or stack trace; read only the involved functions, their tests, and recent
   changes (`git log -p -n 3 -- <file>`).
3. Reproduce with the smallest test or command. If it can't be reproduced, say what you checked.
4. Root cause with `path:line` evidence — cause, not symptom. Grep for the same flaw elsewhere and report it.
   For hard, unclear failures, use `/debug` or the `debugger` agent first.

## Phase 2 — Explain & approve
Present briefly: **what's broken** · **why** (`path:line`) · **proposed minimal fix** · **test plan** (business
language) · **requirement clarification** (which behaviour row/flow to add or sharpen).
**Stop and wait for explicit approval.**

## Phase 3 — Requirement + failing test
1. Update `requirement.md` to describe the correct behaviour (Key behaviours / flows) + one change-log line.
   It describes how the app should work — no bug reports, severities, or incident history.
2. Write a test named in business language ("rejects a second vote from the same participant").
3. Run it; it must **fail for the expected reason**. If it passes, the analysis is wrong — return to Phase 1.

## Phase 4 — Fix & verify
1. Minimal change for the root cause. No refactors, no suppressed errors, no weakened validation/types, no
   `.skip`. Ask before schema changes or dependencies.
2. Run the new test (pass), then the related test files (no regressions), then type-check if available.
3. Report: root cause · files changed · test fail → pass · commands → results · uncertainty. Don't commit.
