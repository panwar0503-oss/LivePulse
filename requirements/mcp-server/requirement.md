# Feature: MCP server for presenters (Claude Desktop and Claude Code)

## Metadata
- **Name**: mcp-server
- **Status**: in_progress
- **Current phase**: initial
- **Created**: 2026-10-25 · **Last updated**: 2026-10-25
- **Parent** (enhancements only): n/a

## Original request
Phase 15 of the LivePulse roadmap (`docs/08-implementation-plan.md`): a presenter can run their live session from
Claude Desktop or Claude Code through a LivePulse MCP server. Roadmap dependencies: phases 5, 11, 12, 13.
Decision for this build: phase 13 (Pulse Coach) is not built, so `get_insights` is left out until it ships.

## What it does
A presenter connects Claude to one of their sessions. Claude can read the live session, create and run polls, ask for
AI poll suggestions, read questions, and propose answer drafts for approval. Every change Claude makes is a proposal.
The presenter approves or rejects each proposal in the web app before it runs. Approved changes go through the same
rules as the web app, so the audience sees them live.

## Who uses it
- **Presenter** — connects Claude to their session, approves or rejects proposals in the web app.
- **Audience** — sees approved changes live; no change to what they can do.
- **Operator (developer)** — sets up the MCP server and checks the setup guide works from a clean Claude Desktop config.

## User stories
1. As a presenter, I want to ask Claude for a live snapshot of my session so that I know what the room is doing.
2. As a presenter, I want Claude to create and start a poll so that the audience sees it without me switching screens.
3. As a presenter, I want to approve or reject each change Claude proposes so that Claude never acts without me.
4. As a presenter, I want Claude to read questions and propose answer drafts so that I can respond faster.
5. As a presenter, I want Claude to be limited to my session so that it cannot touch another session.
6. As an operator, I want setup instructions for Claude Desktop so that the presenter can connect in minutes.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The MCP tool list matches the tools below and nothing else | Read tools: `get_session_snapshot`, `suggest_polls`, `list_questions`, `get_session_report`. Write tools (proposals only): `propose_create_poll`, `propose_start_poll`, `propose_close_poll`, `propose_publish_answer`. Exact names confirmed in the plan |
| 2 | Read-only tools run without approval | Snapshot, questions, report, suggestions |
| 3 | Every write (create, start, close poll; publish answer) becomes a proposal | Stored as PROPOSED; the presenter sees it in the web app's AI panel |
| 4 | Approving a proposal runs the same action as the web app | Same validation, same authorization, audience sees it live |
| 5 | Rejecting a proposal changes nothing in the session | Status REJECTED; nothing emitted to the audience |
| 6 | A wrong or missing presenter key is rejected | Clear error to Claude; no session data returned |
| 7 | A key for one session cannot act on another session | Tools bound to the key's session; no session id accepted from Claude |
| 8 | Proposals survive a server restart | Pending state is in PostgreSQL |
| 9 | Setup instructions work from a clean Claude Desktop config | Covers env values the presenter sets; never prints the key in logs |

## User flows
### Flow 1: Connect and read
1. The presenter creates a session and copies the presenter key (shown once).
2. They add the LivePulse MCP entry to Claude Desktop with the API URL and the key.
3. They ask Claude for the session snapshot; Claude reads it and answers.

### Flow 2: Create and start a poll through Claude
1. The presenter asks Claude to create a poll about pricing.
2. Claude proposes "create poll". The proposal appears in the web app's AI panel.
3. The presenter approves it. The poll is created.
4. Claude proposes "start poll"; the presenter approves; phones update live.

### Flow 3: Reject a proposal
1. Claude proposes "close poll".
2. The presenter rejects it. Nothing changes; Claude is told it was rejected.

### Flow 4: Wrong key
1. Claude is configured with a key that does not match the session.
2. Every tool returns an authorization error. No session data is shown.

### Edge cases
- The session has ended: write proposals are refused with a clear message; reads still work.
- AI is off for the session: the proposal tools are refused with a clear message; read tools still work.
- The presenter never answers a proposal: it stays PROPOSED and can be approved or rejected later.
- An approved proposal fails when run (for example the poll is already started): status FAILED with the reason shown.

## Real-time behaviour
- Approved changes reach the audience through the existing realtime events, unchanged.
- The presenter's AI panel updates when a proposal is created or decided.

## Scope
**In scope**
- MCP server entry point over stdio, a thin client of the REST API, configured with the presenter key from env.
- Tools listed in key behaviour 1.
- Approval-gated proposals (`ai_actions`) and a proposal panel in the presenter web app.
- Setup instructions for Claude Desktop and Claude Code.

**Out of scope**
- `list_my_sessions` (one key is one session; dropped by decision).
- `get_insights` (phase 13 not built).
- Multi-step LangGraph plans with interrupts (phase 15 later part; not in this build).
- Participant access through MCP.
- Writing to the database directly from the MCP server (never allowed).

## Assumptions
1. The MCP server calls the REST API with the presenter key, exchanging it for the presenter cookie through
   `POST /api/sessions/:id/presenter-access`. Reason: the API already accepts only the cookie. Proposed.
2. Proposals use an `ai_actions` table, not a LangGraph checkpointer. Reason: no extra package; docs/10 §5.7E default. Proposed.
3. The developer approved `@modelcontextprotocol/sdk` and the `ai_actions` migration on 2026-10-25.
4. Proposals expire only when the session ends. Proposed.

## Risks
- **HIGH**: Claude acts without approval. Impact: unwanted poll or answer shown to audience. Mitigation: all writes are proposals; tests prove no write runs without an approved row.
- **HIGH**: Key leaks or is used for another session. Impact: privacy and control. Mitigation: key from env only, never logged; tools bound to the key's session; tests with a second session.
- **MEDIUM**: The API's origin check rejects the MCP server's requests. Impact: every write fails. Mitigation: decide and test the origin behaviour for non-browser clients in the plan.
- **MEDIUM**: Approval runs an action that is now invalid. Impact: stale change. Mitigation: approval re-runs the same validation; failure is recorded as FAILED.
- **LOW**: Setup guide drifts from the real config. Impact: presenter cannot connect. Mitigation: check the guide from a clean config.

## Non-functional requirements (user-facing)
- A proposal appears in the web app within 2 seconds of Claude making it.
- Approving a change reaches the audience with the same speed as the web app.

## Success criteria
1. The MCP tool list matches the tool list in this requirement.
2. A wrong presenter key is rejected; a key for another session cannot act on this session.
3. Create and start a poll through Claude: the poll appears only after approval, and phones update live.
4. A rejected proposal changes nothing in the session.
5. Proposals survive a server restart.
6. The setup guide works from a clean Claude Desktop config.
7. Tests run without a real Claude model or Claude Desktop, and make no network call to Anthropic.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-25 | Created from the developer's answers: all writes gated; approve package and ai_actions migration; drop list_my_sessions; leave out get_insights |
