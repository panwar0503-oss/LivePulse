# Feature: UI redesign, clear routes, and clear AI wording

## Metadata
- **Name**: ui-redesign
- **Status**: planning
- **Current phase**: initial
- **Created**: 2026-10-25 · **Last updated**: 2026-10-25
- **Parent** (enhancements only): n/a

## Original request
The developer finds the app hard to use and not polished: the presenter cannot easily see the session or where to
join, a disconnected session is unclear, icons are missing, scrollbars show, and the route names (for example
`/create`) and AI wording are not clear. Asked: improve all pages, use clear route names, and make the UI smooth,
clean and attractive.

## What it does
Every page of the app gets one consistent, polished design. A presenter can see at a glance how the audience joins
and how many people are connected, and can always find the way back into their session. Audience members see a clear
view of how to join and what is live. Web addresses are short and say what the page is for. AI features use plain
words.

## Who uses it
- **Presenter** — creates a session, runs the live room, reviews the report and knowledge.
- **Participant (audience)** — joins with a room code or link, answers polls, asks questions.
- **Developer** — checks the app looks correct and that old links still work.

## Route names (decided)
| Purpose | Current | New |
|---|---|---|
| Home | `/` | `/` |
| Create a session | `/create` | `/host` |
| Presenter room | `/presenter/[sessionId]` | `/host/[sessionId]` |
| Presenter knowledge | `/presenter/[sessionId]/knowledge` | `/host/[sessionId]/knowledge` |
| Presenter report | `/presenter/[sessionId]/report` | `/host/[sessionId]/report` |
| Join with a code | `/join` | `/join` (keeps `?code=`) |
| Audience view | `/session/[roomCode]` | `/room/[roomCode]` |

Old paths redirect permanently to the new ones, so bookmarks and printed links keep working. The join link the API
builds (`/join?code=...`) stays the same.

## AI wording (decided)
- User-visible words change only. API paths and the docs contract do not change.
- Plain labels: "Claude suggestions" (not AI proposals), "Approve" / "Reject", "Ask your session", "AI is on/off" for the
  session switch, "Done" for an executed action, "Could not finish" for a failed one.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | The presenter room shows the join details at all times: room code, join link, copy buttons, QR code | Not hidden after creation |
| 2 | The presenter can always get back to their room from the home page | Enter with the presenter key if the browser lost the session |
| 3 | A connection status shows Live, Reconnecting, or Disconnected, with a plain sentence for each | Visible on presenter and audience pages |
| 4 | The audience sees how many people are connected, and a clear "session ended" state | Count may be unknown; say so plainly |
| 5 | Every button, status and empty state has an icon or clear text | No bare text buttons without context |
| 6 | No visible scrollbars in the app shell or panels; long lists scroll inside their panel without a bar | Scrolling still works |
| 7 | Transitions are smooth; respect reduced-motion settings | No layout jumps when data arrives |
| 8 | Every page works on a phone width with no sideways scroll | 16px side margin |
| 9 | Old routes redirect to the new routes | `/create`, `/presenter/...`, `/session/...` |
| 10 | Loading, empty and error states are the same design on every page | One set of components |

## User flows
### Flow 1: Create and run
1. The presenter opens `/host`, enters a title, and creates the session.
2. The presenter sees the room code, join link and QR code with copy buttons, and a button to open the room.
3. In the room, the join details stay visible in a side panel while the presenter uses the tabs.

### Flow 2: Come back later
1. The presenter opens the home page and chooses "Open my session" with the presenter key.
2. They land in `/host/[sessionId]` with the same join details.

### Flow 3: Connection drops
1. The status shows Reconnecting with a sentence about what is still safe.
2. When the connection returns, the status shows Live and the data refreshes.

### Flow 4: Join as audience
1. The participant opens `/join`, enters the code (or follows the link).
2. They land in `/room/[roomCode]` with the live activities and a connection status.

### Edge cases
- Session ended: the room and audience views show "This session has ended" with the report link for the presenter.
- Unknown room code: a plain not-found message with a way back to join.
- Presenter key rejected: a plain message and a way to try again.

## Scope
**In scope**
- All pages: home, host (create), join, presenter room with all tabs, knowledge, report, audience room.
- Shared design system: icons, buttons, cards, status pills, connection status, empty, loading and error states, scroll
  handling, motion.
- Route renames with permanent redirects.
- AI wording in the app.

**Out of scope**
- API paths, API behaviour, database and realtime event names (no changes).
- New features or new data (only presentation and navigation).
- Dark mode (not asked).
- Native mobile app.

## Assumptions
1. Icons come from an existing icon approach in the repo; if none exists, a single small icon set is needed. A new
   package needs the developer's approval (see the plan). Proposed.
2. The QR code needs a library or a generated image; this needs the developer's approval before adding a package. Proposed.
3. Visual changes do not change what any role can do. Proposed.

## Risks
- **HIGH**: A renamed route breaks a link someone already shared. Impact: audience cannot join. Mitigation: permanent
  redirects for every old path; a test per redirect.
- **MEDIUM**: Redesign breaks existing component tests. Impact: slower work. Mitigation: keep component props and
  behaviour; update only markup and classes; run the full web suite.
- **MEDIUM**: The connection status is wrong and misleads the presenter. Impact: presenter thinks the room is live when
  it is not. Mitigation: status comes from the existing socket state; test each state.
- **LOW**: Scrollbars hidden make long lists hard to scroll. Mitigation: scroll still works; check with keyboard.

## Non-functional requirements (user-facing)
- Pages look the same in style and spacing everywhere.
- No visible scrollbar in normal use; scrolling still works.
- Smooth transitions, and no motion when the user prefers reduced motion.

## Success criteria
1. The presenter room always shows the room code, join link and QR code.
2. A presenter can return to their room from the home page.
3. Connection status shows Live, Reconnecting or Disconnected with a sentence, on presenter and audience pages.
4. Every page uses the same design components; no page uses a bare text-only button.
5. No visible scrollbars in the app shell or normal panels.
6. Each old route redirects to its new route.
7. AI wording in the app uses the plain labels above; API paths are unchanged.
8. Web tests pass; no test or API behaviour changes except route and wording updates.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-25 | Created from the developer's answers: clear routes with redirects; AI wording only; all pages |
