# Feature: AI poll suggestions

## Metadata
- **Name**: ai-poll-generator
- **Status**: in_progress
- **Current phase**: initial
- **Created**: 2026-10-25 · **Last updated**: 2026-10-25
- **Parent** (enhancements only): n/a

## Original request
Phase 11 of the LivePulse roadmap (`docs/08-implementation-plan.md`): grounded poll suggestions that become a poll
when the presenter creates it. Roadmap dependencies: polls (phase 5) and knowledge base (phase 10).

## What it does
After the presenter has uploaded knowledge-base documents, the presenter asks for poll ideas. The system returns three
suggested polls. Each has a question and 2 to 4 options, and each shows the passage it was drawn from. The presenter
opens a suggestion in the existing poll form, edits it if needed, and creates the poll. Nothing reaches the audience
until the presenter creates it. Suggestions are never published automatically.

## Who uses it
- **Presenter** — requests suggestions, reviews the source passage, edits and creates a poll.
- **Participant** — no access. Suggestions are never visible to participants.
- **Operator (developer)** — sets the AI budget and limits; checks background processing.

## User stories
1. As a presenter, I want poll ideas drawn from my own material so that the questions match the talk.
2. As a presenter, I want to see the passage behind each suggestion so that I can check it before using it.
3. As a presenter, I want to edit a suggestion before creating it so that the poll says what I mean.
4. As a presenter, I want no poll to reach the audience without my choice so that nothing goes out by mistake.
5. As an operator, I want suggestion requests limited by the session's AI budget so that cost stays bounded.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The presenter asks for suggestions for the session | Available only when AI is on and at least one document is ready |
| 2 | Each request returns three suggestions | Each has a question and 2 to 4 options |
| 3 | Every suggestion shows the document name, location and the passage it came from | Passage text is shown to the presenter only |
| 4 | Suggestions are drawn only from ready knowledge-base passages | Nothing is invented; with no relevant passage, there are no suggestions and the presenter is told so |
| 5 | Opening a suggestion fills the poll form; the presenter edits and creates the poll | Creating uses the existing poll rules (one open poll per session, and so on) |
| 6 | A suggestion is not stored as a poll until the presenter creates it | Dismissed suggestions leave no trace in the audience's view |
| 7 | Suggestions are never shown to participants | — |
| 8 | Each request uses the session's AI token budget | A request that would exceed the budget is refused with a clear message |
| 9 | Repeated identical requests in a short time return the same request, not a second one | Avoids paying twice for a double click |
| 10 | If AI is off, unavailable or over budget, poll creation by hand still works | Core polls are unaffected |

## User flows
### Flow 1: Suggest and create
1. Presenter opens the poll tab and chooses "Suggest polls".
2. The panel shows "Finding poll ideas…".
3. Three suggestions appear, each with its source passage.
4. Presenter chooses "Use this" on one; the poll form opens filled in.
5. Presenter edits the text if needed and presses Create. The poll opens to the audience as it does today.

### Flow 2: Nothing relevant
1. Presenter asks for suggestions, but the documents have no relevant passage.
2. The panel shows "No poll ideas were found in your documents. Try another document or write the poll by hand."

### Flow 3: AI off or over budget
1. Presenter asks while AI is off for the session.
2. The panel shows "Turn AI on for this session to get poll ideas."
3. If the budget is used up, it shows "This session has used its AI budget. Write the poll by hand."

### Edge cases
- The presenter asks twice quickly → one request, shown once.
- A suggestion is open in the form and the presenter asks again → the form is not changed until the presenter chooses a new suggestion.
- The session ends while a request is running → the request is cancelled and no suggestions are shown.

## Real-time behaviour
- Suggestions appear for the presenter only, when the request finishes.
- On reconnect or reload, the poll tab loads the latest suggestions for the session.

## Scope
**In scope**
- Suggestion requests grounded in ready knowledge-base passages.
- Three suggestions per request, each with a source passage.
- Opening a suggestion in the poll form for the presenter to edit and create.
- Budget and rate limits for requests.

**Out of scope**
- Suggestions from the presenter's free-text topic (not grounded).
- Suggestions drawn from the audience's questions (phase 12).
- Image or media polls.
- Automatic publishing of any suggestion.

## Assumptions
1. AI must be on for the session before requests work — same rule as knowledge upload. Proposed.
2. No relevant passage means no suggestions, not invented ones. Proposed.
3. Suggestions are drafts held only for the presenter; they are not stored as polls. Proposed.
4. Requests use the existing background job runner and the session's token budget. Reason: consistent with other AI features. Proposed.
5. Participants never see suggestions. Developer chose this (presenter review).

## Risks
- **MEDIUM**: A suggestion misstates its source. Impact: a wrong question reaches the audience if the presenter does not check. Mitigation: the passage is shown next to each suggestion; creating is always the presenter's choice.
- **MEDIUM**: The model returns a malformed suggestion. Impact: a failed request or an unusable poll. Mitigation: strict validation of the output; a malformed suggestion is dropped, and if none remain the presenter is told.
- **LOW**: Repeated requests cost tokens. Mitigation: per-session budget and a short duplicate window.

## Non-functional requirements (user-facing)
- Suggestions appear within 15 seconds of the request on this machine.
- Nothing about suggestion requests slows polls, word cloud or Q&A for the audience.

## Success criteria
1. A presenter with a ready document gets three suggestions, each with its source passage.
2. Opening a suggestion fills the poll form; nothing is created until the presenter presses Create.
3. A participant cannot see or request suggestions.
4. With AI off, a request is refused and no model call is made.
5. With no relevant passage, no suggestions are shown and the presenter is told so.
6. A request over the session budget is refused with the budget message.
7. Two identical quick requests produce one request.
8. Malformed model output never becomes a suggestion.
9. Polls and Q&A keep working while requests run or fail.
10. Tests run with the fake provider and make no network call.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-25 | Created from the developer's answers (knowledge base only; three suggestions; presenter creates the poll) |
