# Feature: Live Q&A

## Metadata
- **Name**: live-qna
- **Status**: completed
- **Current phase**: initial
- **Created**: 2026-10-24 · **Last updated**: 2026-10-24
- **Parent** (enhancements only): n/a

## Original request
Phase 7 of the LivePulse roadmap (`docs/08-implementation-plan.md`): participants ask questions and upvote other people's
questions (one upvote each, never their own). Everyone sees the question list live, sorted by upvotes then age. The
presenter can open and close Q&A, pin, hide, mark answered and type a short answer that appears under the question.
Hidden or rejected questions are never shown to participants. Rate limits stop spam.

## What it does
During a session the audience can type a question. Each question appears on everyone's screen at once, and people
upvote the questions they want answered. The most-upvoted questions rise to the top. The presenter can pin a question,
hide one that is inappropriate, mark one answered, and type a short answer that everyone then sees under it. The
presenter can pause Q&A for the whole session; while paused, nobody can ask or upvote, but the list stays visible.

## Who uses it
- **Presenter** — opens and closes Q&A, pins, hides and restores questions, marks answers, writes short answers.
- **Participant** — asks questions, upvotes questions from others, sees answers the presenter writes.

## User stories
1. As a participant, I want to ask a question so that the presenter sees what the room wants to know.
2. As a participant, I want to upvote a question I also want answered so that the most important ones rise to the top.
3. As a presenter, I want the most-upvoted questions first so that I can choose what to answer.
4. As a presenter, I want to hide a question that is inappropriate so that the room does not see it.
5. As a presenter, I want to answer a question in a few words so that everyone sees the answer.
6. As a presenter, I want to pause Q&A so that new questions stop while I am on a different topic.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | A participant submits a question | Trimmed, 1–200 characters, no control characters; empty refused with a clear message |
| 2 | Each participant can submit up to 5 questions per session | The sixth is refused with a clear message |
| 3 | Questions appear to everyone straight away | Hidden or rejected questions are never shown to participants |
| 4 | A participant upvotes a question once | A repeat upvote does nothing; nobody can upvote their own question |
| 5 | The list is ordered by upvotes (most first), then oldest first | The order is the same for every screen |
| 6 | The presenter can pin a question to the top | Pinned questions stay first regardless of upvotes |
| 7 | The presenter can hide a question and restore it later | Hidden questions disappear from participants' screens at once |
| 8 | The presenter can mark a question answered and write a short answer (up to 500 characters) | The answer is shown to everyone under the question as plain text |
| 9 | The presenter can open and close Q&A for the session | While closed, new questions and upvotes are refused with a clear message; existing questions stay visible |
| 10 | Text is always shown as plain text | Markup typed in a question or answer is shown literally, never run |
| 11 | Ending the session closes Q&A | No submissions or upvotes after the session has ended |
| 12 | Repeated or simultaneous requests never add a second upvote or a second copy of a question | Retries are safe |

## User flows
### Flow 1: Participant asks and upvotes
1. Participant types a question and submits it. It appears on every screen.
2. Other participants upvote it; the count and position update live.
3. The participant who asked sees their own question marked as theirs and cannot upvote it.

### Flow 2: Presenter answers
1. Presenter sees the list, sorted by upvotes.
2. Presenter pins the most important question, types a short answer and marks it answered.
3. Everyone sees the answer under the question at once.

### Flow 3: Presenter pauses and resumes Q&A
1. Presenter closes Q&A.
2. Participants see "Q&A is paused by the presenter." and cannot ask or upvote.
3. Presenter reopens Q&A; participants can ask and upvote again.

### Edge cases
- Two identical upvotes at the same moment → one upvote.
- A question submitted just as the presenter pauses Q&A → one clear outcome: recorded before the pause, or refused with a clear message.
- Presenter hides a question that has upvotes → it leaves every screen; restoring brings it back with its upvotes.
- A participant reloads → their own upvotes are shown as given and cannot be repeated.
- Answer text with markup → shown literally.
- Ending the session → Q&A closes; no further questions or upvotes.

## Real-time behaviour
- Live to everyone in the session: a new question, a change in upvotes, a question hidden or restored, an answer written, a pin change, Q&A opened or closed.
- On reconnect or reload, every screen loads the current list from the server.
- Participants never receive hidden questions, presenter-only notes, or other people's identities.

## Scope
**In scope**
- Submit questions (5 per participant per session), upvote once per question, live ordered list.
- Presenter: pin, hide, restore, mark answered, short answer (500 characters), open and close Q&A.
- Plain-text display of questions and answers.
- Recovery after reconnect and reload.

**Out of scope**
- AI moderation of questions (a later AI feature; this phase only lets the presenter hide questions).
- Approving questions before they are shown (visibility is immediate by choice).
- Threaded replies or comments on questions.
- Editing or deleting a question by its author.
- Identifying participants by name beyond what the presenter already sees.

## Assumptions
1. Questions are visible straight away; the presenter moderates by hiding. Developer chose this.
2. Q&A has an open and closed switch for the whole session. Developer chose this.
3. Answers are up to 500 characters, plain text, one per question (a new answer replaces the old one). Developer chose this.
4. Up to 5 questions per participant per session; one upvote per question per participant. Developer chose this.
5. Upvotes on a question are visible to everyone (counts only, never who voted). Reason: consistent with polls.
6. Pinning is limited to one pinned question at a time. Reason: keeps the top of the list clear. Proposed; confirm.
7. Hidden questions keep their upvotes, so restoring one brings it back intact. Reason: no data is lost by hiding.

## Risks
- **HIGH**: Hidden questions leaking to participants through the live channel or the API. Impact: the presenter's moderation control is bypassed. Mitigation: the server filters per recipient; tests inspect every participant-facing response and message.
- **HIGH**: Duplicate upvotes or questions under concurrency or retries. Impact: wrong ranking. Mitigation: unique keys in the database for upvotes and per-participant limits; retries are safe.
- **MEDIUM**: Abusive or spam questions before the presenter sees them. Impact: a noisy room. Mitigation: the 5-question cap, rate limits, and the presenter's hide control; AI moderation is the later answer.
- **MEDIUM**: Ranking changes so fast that the list jumps while someone reads it. Impact: confusion. Mitigation: changes are sent as small updates and the order is stable for equal counts.
- **LOW**: Answers that disagree with the presenter's own speech. Impact: confusion. Mitigation: the presenter writes the answer; it is clearly marked as the presenter's.

## Non-functional requirements (user-facing)
- A new question appears on every screen within 2 seconds.
- An upvote updates the position within 2 seconds.
- The list is usable on a phone: large buttons for upvote, readable question text.

## Success criteria
1. A participant submits a question and everyone in the session sees it without a refresh.
2. A sixth question from one participant in one session is refused with a clear message.
3. One participant upvoting the same question twice, or from two tabs, produces exactly one upvote.
4. A participant cannot upvote their own question.
5. The list is ordered by upvotes then age, and pinned questions stay first.
6. A hidden question is absent from every participant-facing response and message; restoring it brings it back with its upvotes.
7. The presenter's short answer appears under the question for everyone, as plain text.
8. While Q&A is closed, new questions and upvotes are refused with a clear message; reopening restores them.
9. A question or answer containing markup is shown as literal text.
10. Ending the session closes Q&A and refuses later questions and upvotes.
11. The presenter key and participant identities never appear in any message to participants.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-24 | Created and confirmed (questions visible immediately; Q&A open/close switch; 500-character answers; 5 questions and one upvote per question per participant) |
