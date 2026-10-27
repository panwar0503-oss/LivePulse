# Feature: Post-session report and "Ask your session"

## Metadata
- **Name**: ai-session-report
- **Status**: in_progress
- **Current phase**: initial
- **Created**: 2026-10-25 · **Last updated**: 2026-10-25
- **Parent** (enhancements only): n/a

## Original request
Phase 14 of the LivePulse roadmap (`docs/08-implementation-plan.md`): a post-session report, and an "Ask your session"
streaming chat that answers questions about the session using read-only session tools. Roadmap dependencies: phases 5–13.
Decision for this build: phases 12 (Q&A copilot) and 13 (live insights) are not built yet, so the report and chat cover
polls, word cloud, Q&A and knowledge documents now. Copilot and insights sections are added when those phases ship.

## What it does
When a session ends (or at any time while it runs), the presenter can open a report. It lists the session's facts:
poll results, the top word-cloud terms, question counts, the top-upvoted questions, the knowledge documents used, and
AI usage. Nothing in the report is written by AI. The presenter can also ask questions about the session in a chat.
Answers come from the session's own data, read through a fixed set of read-only tools, and are streamed as they arrive.
Each answer shows which data it came from.

## Who uses it
- **Presenter** — opens the report, exports it, asks questions in the chat.
- **Participant** — no access to the report or the chat.
- **Operator (developer)** — sets the AI budget and limits; checks background processing.

## User stories
1. As a presenter, I want a report of my session so that I can review what happened after it ends.
2. As a presenter, I want to ask about my session in plain words so that I find facts without scrolling through screens.
3. As a presenter, I want each answer to show where it came from so that I can trust it.
4. As a presenter, I want to export the report so that I can share it with my team.
5. As an operator, I want chat answers limited by the session's AI budget so that cost stays bounded.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The report lists poll results, top word-cloud terms, question counts and top-upvoted questions, knowledge documents used, and AI usage | Facts from the data only; nothing AI-written |
| 2 | The report is available while the session runs and after it ends | Numbers after the end are final |
| 3 | The presenter can export the report as a file | Export contains the same facts as the page |
| 4 | "Ask your session" answers questions about this session only | Refuses questions about other sessions or unrelated topics |
| 5 | Answers are streamed to the presenter as they are written | The presenter sees progress; a failed stream shows a clear message |
| 6 | Each answer lists the sources it used (poll, word prompt, question, or document name) | Sources are shown with each answer |
| 7 | The chat can only read session data through fixed read-only tools | It cannot change anything in the session |
| 8 | If the answer is not in the data, the chat says so | No invented numbers |
| 9 | Each chat question uses the session's AI budget | A question over budget is refused with a clear message |
| 10 | Participants never see the report, the chat, or any of its data | — |
| 11 | When AI is off, the report still works; the chat is unavailable with a clear message | Core data is not affected |

## User flows
### Flow 1: Report after the session
1. The session ends.
2. The presenter opens the report from the session's dashboard.
3. The report shows its facts; the presenter exports it if needed.

### Flow 2: Ask your session
1. The presenter types a question, for example "Which question got the most votes?"
2. The answer starts to appear in the chat.
3. The answer ends with its sources; the presenter can ask a follow-up.

### Flow 3: Not in the data
1. The presenter asks something the session did not record.
2. The chat says it cannot find this in the session and suggests what was recorded instead.

### Flow 4: AI off or over budget
1. The presenter asks a question while AI is off, or after the budget is used up.
2. The chat shows "Turn AI on for this session to ask questions." or "This session has used its AI budget."
3. The report stays available.

### Edge cases
- The session has no data (no polls, no questions): the report says so plainly.
- The stream is interrupted: the partial answer is marked incomplete and the presenter can ask again.
- The same question is sent twice quickly: one answer.

## Real-time behaviour
- The report updates for the presenter while the session runs, and is final when it ends.
- The chat streams to the presenter only.
- On reload, the presenter sees the report and the chat history for this session.

## Scope
**In scope**
- Session report page: polls, word cloud, questions, knowledge documents, AI usage.
- Export of the report.
- "Ask your session" chat, streamed, with fixed read-only tools over the session's data.
- Source labels on every answer.
- Budget and rate limits for chat questions.

**Out of scope**
- AI-written narrative or summary of the session.
- Copilot and insights sections (added when phases 12 and 13 ship).
- Participant access to the report or chat.
- Chat answers about other sessions or about anything outside the session.
- Actions that change the session (phase 15 covers approval-gated actions).

## Assumptions
1. Report and chat use only the session's own data: polls, word-cloud responses, questions, upvotes, documents. Proposed.
2. Chat tools are fixed and read-only; the model cannot run arbitrary queries. Reason: safety and predictability. Proposed.
3. The chat uses the existing AI budget and session AI switch; with AI off, the chat is unavailable. Developer chose presenter-only access and the no-narrative report; AI rules follow the other AI features. Proposed.
4. Export is a file download the presenter starts; nothing is emailed or published. Proposed.
5. Chat history is kept for the session and removed when the session's data is removed. Proposed.

## Risks
- **HIGH**: The chat answers with invented numbers. Impact: the presenter repeats a false fact. Mitigation: answers come from tool results only; each answer shows its sources; "not in the data" is a required outcome.
- **HIGH**: A chat tool reads data it should not, or writes. Impact: privacy or data change. Mitigation: fixed read-only tools, presenter-only access, session scope on every tool.
- **MEDIUM**: Long sessions make the chat slow or expensive. Impact: slow answers, budget used quickly. Mitigation: tools return summaries with counts and limits; per-question budget check.
- **MEDIUM**: Streaming breaks on a dropped connection. Impact: half-written answers. Mitigation: partial answers are marked incomplete.
- **LOW**: Export file contains more than the page shows. Impact: data exposure in a file. Mitigation: the export uses the same DTOs as the page.

## Non-functional requirements (user-facing)
- The report opens within 2 seconds for a session with 500 participants.
- The first words of a chat answer appear within 5 seconds of asking.
- Nothing about the report or chat slows polls, word cloud or Q&A for the audience.

## Success criteria
1. The report shows poll results, top terms, question counts, top questions, documents and AI usage, matching the live data.
2. The report is available during and after the session; the figures after the end do not change.
3. The export contains the same facts as the page.
4. A chat question is answered from the session's data, with sources shown.
5. A question the data does not answer gets a clear "not in the data" answer, with no invented number.
6. A participant cannot open the report, the chat, or their data.
7. With AI off or over budget, the chat is unavailable with a clear message and the report still works.
8. Chat tools cannot change session data.
9. Tests run with the fake provider and make no network call.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-25 | Created from the developer's answers: build now with existing features; facts-only report; presenter-only access |
