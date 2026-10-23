---
name: requirement-clarifier
description: Turn a vague LivePulse feature request into a confirmed requirement - questions, assumptions, scope, risks, success criteria. Used by /requirement and /enhance.
---

# Requirement clarifier

Goal: build exactly what the developer needs, with no speculative scope. Tone: collaborative
("I want to make sure we build exactly what you need"), never "your requirement is vague".

## 1. Analyse
Separate what is **stated**, what is **missing/ambiguous**, and what you'd be **assuming**.

## 2. Ask only genuinely ambiguous questions (one batched message, most important first)
| Dimension | Typical LivePulse questions |
|---|---|
| Roles | Host only, participants, anonymous participants? Can a host be a participant? |
| Scope | Which pages/endpoints? MVP vs later? One session or many? |
| UX | Happy path, empty state, error cases, mobile browser vs desktop |
| Data & state | What is stored, for how long, who can see it? Editable after submit? |
| Real-time | What updates live, for whom, how fast? What does a late joiner / reconnecting user see? |
| Integrity | Duplicate submissions? Limits (options per poll, message length)? Closing/expiry rules? |
| Constraints | New dependencies or services? (need approval) Accessibility, privacy expectations |

Don't ask what the codebase or `CLAUDE.md` already answers.

## 3. Propose assumptions
Reasonable defaults with a one-line reason each, so the developer can confirm quickly.

## 4. Scope boundaries
Explicit **In scope** and **Out of scope** lists in business terms.

## 5. Risks
HIGH / MEDIUM / LOW with business impact and mitigation (e.g. vote manipulation, data exposure across
sessions, lost live updates).

## 6. Report (present, then wait)
- Original request (verbatim)
- Clarified statement (1–3 sentences)
- Questions asked / answers
- User stories and key behaviours (numbered, testable)
- User flows (plain steps; no code or component names)
- Real-time behaviour
- Scope in/out · assumptions · risks · user-facing NFRs
- Success criteria (user-observable)

Confirmed → write `requirement.md`. Revised → update and re-present. Rejected → discuss alternatives.
