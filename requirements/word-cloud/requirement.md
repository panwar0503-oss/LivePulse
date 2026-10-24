# Feature: Word cloud

## Metadata
- **Name**: word-cloud
- **Status**: completed
- **Current phase**: initial
- **Created**: 2026-10-24 · **Last updated**: 2026-10-24
- **Parent** (enhancements only): n/a

## Original request
Phase 6 of the LivePulse roadmap (`docs/08-implementation-plan.md`): the presenter opens a word-cloud prompt; each
participant submits one short word or phrase; everyone sees a live word cloud where identical answers (ignoring case
and extra spaces) grow bigger. Text is always shown safely, empty clouds show a friendly state, and the counting is
exact and deterministic (this feature is not AI). The presenter can close the prompt.

## What it does
The presenter asks an open question such as "One word for how you feel about AI at work?". Participants type one
word or short phrase. The answers appear as a cloud in which the words that come up most often are shown larger.
The presenter decides whether participants can see the cloud. When the presenter closes the prompt, no more answers
are accepted, and the final cloud stays available.

## Who uses it
- **Presenter** — opens and closes a prompt, decides whether participants see the cloud, reads the counts.
- **Participant** — submits one word or phrase per prompt and, if allowed, sees the cloud.

## User stories
1. As a presenter, I want to ask a question and collect short answers so that the room's view is visible at a glance.
2. As a presenter, I want to hold the cloud back until I am ready so that the reveal is mine.
3. As a participant, I want to submit one word and see it count so that I know my answer is part of the room's view.
4. As a participant, I want a clear message when my word is too long or empty so that I can fix it at once.
5. As a presenter, I want to close the prompt so that the answers stop coming in.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The presenter creates a prompt with a question | Question up to 200 characters, the same limit as polls |
| 2 | Only one prompt can be open at a time in a session | Opening a new prompt closes the previous one; the room always sees the open prompt |
| 3 | A participant submits one word or phrase per prompt | Trimmed; empty input refused with a clear message; up to 30 characters |
| 4 | Identical answers count together, ignoring letter case and extra spaces | "Work life", "work  LIFE" and " work life " are one entry |
| 5 | Each entry keeps a readable display form | The most common spelling shown, not the normalised key |
| 6 | The cloud shows the most frequent entries first, in a fixed order | At most 30 entries; ties broken alphabetically so the order never jumps |
| 7 | A participant's word is final | A second submission for the same prompt is refused; retries do not add a second word |
| 8 | Text is always shown as plain text | Markup in an answer is shown as typed, never run |
| 9 | The presenter chooses whether participants see the cloud, per prompt | Default on; the server decides, and a hidden cloud is never sent to participants |
| 10 | Closing a prompt stops all submissions at once | A submission arriving at the same moment as the close has one clear outcome |
| 11 | A closed prompt keeps its final cloud for the presenter | Participants also see it when the presenter allows |
| 12 | A participant who reloads sees their own word and cannot submit again | Their word is marked, not just hidden |
| 13 | An empty cloud shows a friendly message, never an error | "No words yet. Answers will appear here." |
| 14 | Ending the session closes an open prompt | No submissions after the session has ended |

## User flows
### Flow 1: Presenter runs a prompt
1. Presenter writes the question and chooses whether participants see the cloud.
2. Presenter opens the prompt. Participants see it at once.
3. Answers arrive; the presenter sees the cloud update.
4. Presenter closes the prompt. Submissions stop everywhere.

### Flow 2: Participant answers
1. Participant sees the question and a single text box.
2. Participant types a word and submits. The screen confirms "Your word is in."
3. If the presenter allows it, the participant sees the cloud update live.
4. If the participant reloads, their word is still shown and the box is disabled.

### Edge cases
- Submit empty or only spaces → refused with "Type a word or short phrase."
- Submit more than 30 characters → refused with a message showing the limit.
- Two taps or two tabs at once → one word counted.
- Submission arrives just after close → refused with "This prompt is closed."
- Markup such as `<b>` typed by a participant → shown as the literal text.
- Presenter hides the cloud while answers come in → participants see nothing new.

## Real-time behaviour
- Live to the presenter: the cloud updates after each accepted word.
- Live to participants, only while the cloud is shown: the cloud updates.
- Open and close of a prompt reach everyone in the session.
- On reconnect or reload, every screen loads the current prompt and cloud from the server.

## Scope
**In scope**
- Create a prompt; open and close it; one open prompt at a time per session.
- Participant submission of one word or phrase per prompt, with normalisation and length rules.
- Live cloud for the presenter; live cloud for participants when allowed.
- Show or hide the cloud per prompt.
- Recovery after reconnect and reload; friendly empty state.

**Out of scope**
- AI or semantic grouping of similar words (for example "teamwork" and "collaboration") — a later AI feature.
- Editing or deleting a submitted word.
- Moderation of inappropriate words (later, with Q&A moderation).
- Images, emoji-only answers, or multiple words per submission.
- Exporting the cloud.

## Assumptions
1. One open prompt at a time. Reason: keeps the room on one question. Developer chose this.
2. Submissions are final; one per participant per prompt. Developer chose this.
3. Maximum 30 characters per submission; questions up to 200 characters. Developer chose these limits.
4. Show-cloud switch per prompt, default on. Developer chose this.
5. The cloud shows at most 30 entries. Reason: keeps the cloud readable on a phone and bounds the data sent. Proposed; confirm.
6. Participants see the same normalised grouping as the presenter. Reason: one consistent count for everyone. Proposed.
7. Closed prompts keep their cloud so the presenter can reveal it later. Reason: same as polls.

## Risks
- **HIGH**: Hidden clouds leaking to participants through the live channel or the API. Impact: the presenter's reveal control is bypassed. Mitigation: the server filters per recipient; tests inspect every participant-facing response and message.
- **HIGH**: Two submissions racing to be the one allowed word, or a submission racing the close. Impact: wrong count or a word after close. Mitigation: one submission per participant per prompt in the database; the prompt state checked under a lock, the same pattern as polls.
- **MEDIUM**: Offensive words shown to the room. Impact: the room sees something inappropriate. Mitigation: presenter switch to hide the cloud; moderation is a later feature, stated as a known limitation.
- **MEDIUM**: Very many distinct words slow the cloud down. Impact: slow updates. Mitigation: top 30 only, computed in the database.
- **LOW**: Unicode lookalike characters split one word into two entries. Impact: a slightly odd count. Mitigation: case and spacing normalised; accents are kept (stated as a known limit).

## Non-functional requirements (user-facing)
- A submission is confirmed to the participant within 1 second on a normal connection.
- The presenter's cloud updates within 2 seconds of a submission.
- The participant screen works on a phone: large text box, clear submit button.

## Success criteria
1. The presenter opens a prompt; a connected participant sees it without a refresh.
2. Opening a second prompt closes the first; the room sees only the open one.
3. Two submissions that differ only by case or extra spaces appear as one entry with the combined count.
4. Empty, whitespace-only, and over-30-character submissions are refused with clear messages.
5. One participant sending the same word twice, or from two tabs, produces one count.
6. With the cloud hidden, no participant-facing response or message contains any word or count.
7. With the cloud shown, participants see the cloud update live.
8. A submission arriving after close is refused; one arriving at the same moment as close has one clear outcome, checked by a concurrency test.
9. Typed markup is shown as plain text in the cloud and in the presenter view.
10. An empty cloud shows the friendly message, not an error.
11. Ending the session closes an open prompt and refuses later submissions.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-24 | Created and confirmed (one open prompt; 30-character limit; show-cloud switch per prompt, default on; submissions final) |
