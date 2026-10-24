# Feature: Live polls

## Metadata
- **Name**: live-polls
- **Status**: completed
- **Current phase**: initial
- **Created**: 2026-10-24 · **Last updated**: 2026-10-24
- **Parent** (enhancements only): n/a

## Original request
Phase 5 of the LivePulse roadmap (`docs/08-implementation-plan.md`): the presenter creates multiple-choice polls
(2–6 options), starts one at a time, and closes it. Participants vote once per poll and see results live if the
presenter allows it; the presenter always sees live counts and percentages. Duplicate or simultaneous votes from the
same participant count once, votes after closing are rejected, and a vote and a close happening at the same moment must
have one clear outcome. Closed polls are read-only.

## What it does
During a session the presenter prepares questions with 2–6 answers. When the presenter starts a poll, every connected
participant sees the question and its options. Each participant chooses one option. The presenter sees the counts and
percentages update live. If the presenter allows it, participants see the same live results. When the presenter closes
the poll, voting stops everywhere and the final results stay visible to everyone who is allowed to see them.

## Who uses it
- **Presenter** — creates polls, starts and closes them, chooses whether participants see live results, and reads the
  counts.
- **Participant** — votes once in an open poll and, if allowed, sees the results.

## User stories
1. As a presenter, I want to prepare several polls before the session so that I can run them quickly.
2. As a presenter, I want to start one poll and close it when I am ready so that the room answers one question at a time.
3. As a presenter, I want to decide whether participants see the results so that I can keep a reveal for later.
4. As a participant, I want to vote once and see that my vote was recorded so that I know it counted.
5. As a participant, I want to see the results live when the presenter allows it so that the moment feels shared.
6. As a presenter, I want a poll to stop accepting votes the moment I close it so that the final count is fixed.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The presenter creates a poll with a question and 2–6 options | Question up to 200 characters; each option up to 80 characters; options must be non-empty and distinct |
| 2 | A new poll starts as a draft that participants cannot see | Its question and options are fixed once created (see Assumption 2) |
| 3 | Only one poll can be open at a time in a session | Starting a poll is refused while another is open, with a clear message |
| 4 | Starting a poll makes it visible to every connected participant at once | Participants who join later see the open poll on arrival |
| 5 | Each participant can vote once per poll | The first vote is final; repeat or simultaneous votes do not add a second vote |
| 6 | A participant's vote is recorded only if the poll is open and the session is active | Otherwise the vote is refused with a clear message |
| 7 | Live counts and percentages update for the presenter after each recorded vote | Percentages are shown with counts, not only as bars |
| 8 | Participants see live results only when the presenter has chosen to show them for that poll | The server decides, not the page; hidden results are never sent to participants |
| 9 | Closing a poll stops all votes at once | A vote that arrives at the same moment as the close has one clear outcome |
| 10 | A closed poll is read-only: no vote, no edit, no restart | Its final result stays visible to participants when results are shown |
| 11 | A participant who reloads sees their own choice if they already voted | Their choice is shown; they cannot vote again |
| 12 | Votes are never counted twice, even when the same request is sent twice | Retried requests do not inflate the count |
| 13 | The poll cannot be started or voted on after the session has ended | Ending the session closes any open poll |

## User flows
### Flow 1: Presenter runs one poll
1. Presenter creates a poll: question, options, and whether participants see results.
2. Presenter starts the poll. Participants see it at once.
3. Participants vote. The presenter sees counts and percentages change.
4. Presenter closes the poll. Voting stops everywhere. Results stay on the presenter's screen.

### Flow 2: Participant votes
1. Participant sees the open poll and chooses one option.
2. The screen confirms "Your vote is recorded."
3. If results are shown, the participant sees the counts update live.
4. The participant reloads the page: their choice is still marked and they cannot vote again.

### Flow 3: Presenter closes during voting
1. A participant presses an option at the moment the presenter presses Close.
2. Exactly one outcome happens: the vote is recorded before the close, or it is refused with "This poll is closed."
3. Every screen then shows the poll as closed.

### Edge cases
- Two taps on the same option by one participant → one vote.
- Two browser tabs of one participant voting at once → one vote.
- Presenter tries to start a second poll while one is open → refused with a clear message.
- Presenter tries to start a poll after the session has ended → refused.
- Participant votes on a closed poll → refused, and the screen shows the closed state.
- Presenter switches "show results" on or off while the poll is open → participants' view follows at once.
- Poll with duplicate option labels → refused when created.

## Real-time behaviour
- Live to everyone in the session: poll started, poll closed.
- Live to the presenter: each recorded vote updates counts and percentages.
- Live to participants, only if the poll shows results: counts and percentages.
- On reconnect, every screen refetches the current poll state; the live channel is never the only source.

## Scope
**In scope**
- Create a poll (draft) with question and 2–6 options, and a per-poll switch for showing results.
- Start, close, and show or hide results for a poll.
- Participant vote, once per poll, with clear feedback.
- Live counts and percentages for the presenter; live results for participants when allowed.
- Recovery after reconnect and reload.
- One open poll at a time per session.

**Out of scope**
- Several polls open at once.
- Editing a poll after it is created.
- Changing a vote.
- Multiple-choice answers (one option per participant).
- Quizzes with correct answers and scores.
- Exporting results; charts beyond counts and percentages.
- Anonymous or identified voting reports beyond the counts.

## Assumptions
1. One open poll at a time. Reason: keeps the audience's screen simple. Developer chose this.
2. Options are fixed once a poll is created. Reason: avoids confusion for anyone who already saw the poll; edits can come later. Proposed; confirm.
3. Results visibility is a per-poll switch, default on. Reason: the presenter must control reveal timing. Developer chose the per-poll switch.
4. Votes are final. Developer chose this.
5. Question up to 200 characters; option up to 80 characters; 2–6 options. Developer chose these limits.
6. A draft poll is visible only to the presenter. Reason: the presenter prepares before the room sees it.
7. Results are kept after the poll closes, so the presenter can show them later in the session. Reason: closed polls are read-only, not deleted.

## Risks
- **HIGH**: A vote and a close racing at the same moment could count a vote after close. Impact: wrong final result. Mitigation: the poll's state is checked and the vote recorded in one locked step; a concurrency test covers it.
- **HIGH**: Hidden results leaking to participants through the live channel or the API. Impact: the presenter's reveal control is bypassed. Mitigation: the server filters results per recipient; tests inspect every participant-facing response and message.
- **MEDIUM**: Repeated or retried vote requests inflating the count. Impact: wrong totals. Mitigation: one vote per participant per poll enforced in the database; retries return the same result.
- **MEDIUM**: Participants who join late miss the start event. Impact: they do not know a poll is open. Mitigation: on join and on reconnect the current open poll is returned.
- **LOW**: Percentages rounding so they do not add to 100. Impact: small visible mismatch. Mitigation: show counts beside percentages, and say that percentages are rounded.

## Non-functional requirements (user-facing)
- A vote is confirmed to the participant within 1 second on a normal connection.
- Counts for the presenter update within 2 seconds of a vote.
- A participant can vote from a phone screen with large, labelled options.

## Success criteria
1. The presenter creates a poll with 2–6 options; 1 option or 7 options is refused with a clear message.
2. Starting a poll shows it to a connected participant without a page refresh.
3. A second poll cannot be started while one is open.
4. One participant pressing an option twice or from two tabs produces exactly one vote.
5. Two different participants voting at the same time are both counted.
6. With results hidden, a participant's screen and every message sent to participants contain no counts.
7. With results shown, the participant sees the counts update live.
8. A vote that arrives after close is refused; a vote arriving at the same moment as close produces one clear outcome, checked by a concurrency test.
9. After closing, no further votes are accepted, and the final result is still shown to the presenter.
10. A participant who reloads after voting sees their choice and cannot vote again.
11. Ending the session closes an open poll and refuses later polls.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-24 | Created and confirmed (one open poll; per-poll result switch, default on; votes final; 200/80 character limits) |
