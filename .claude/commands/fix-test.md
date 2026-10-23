---
description: Diagnose failing tests against the requirement (test wrong, code wrong, or requirement ambiguous), get approval, fix.
argument-hint: "<test file, pattern, or workspace: api | web | shared>"
disable-model-invocation: true
---

# /fix-test $ARGUMENTS

## 0. Identify
Run the given scope (file, `-t` pattern, or workspace) with a quiet reporter. No scope → ask which. Collect each
failing test name and file. All pass → report and stop.

## 1. Requirement
For each failure, find the feature in `requirements/` and read the relevant behaviour. None → say so, infer from
the test and code, and ask the developer to confirm the intended behaviour.

## 2. Diagnose & explain
Per failing test, briefly:
- **Test** · **File** `path:line` · **Requirement**
- **Should happen** (business language) / **Actually happens**
- **Why** (`path:line`) · **Diagnosis:** test wrong | code wrong | requirement ambiguous
- **Proposed fix**

**Stop and wait for approval.**

## 3. Fix (approved changes only)
- Test wrong → update the assertion to match the requirement.
- Code wrong → minimal code fix.
- Requirement ambiguous → clarify `requirement.md` (behaviour, not bug history), then fix as agreed.
Test names stay in business language. Never `.skip`, delete, or loosen a test to get green.

## 4. Verify
Re-run the failing tests, then their whole files. Report: failing before → fixed now, one line per change.
