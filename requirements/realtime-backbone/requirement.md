# Feature: Live connection backbone

## Metadata
- **Name**: realtime-backbone
- **Status**: completed
- **Current phase**: initial
- **Created**: 2026-10-24 · **Last updated**: 2026-10-24
- **Parent** (enhancements only): n/a

## Original request
Phase 4 of the LivePulse roadmap (`docs/08-implementation-plan.md`): everyone in a session stays in sync live. Presenter
and participants connect and are placed into the session. The presenter sees how many people are connected right now.
When anyone reconnects or refreshes they get the current session state from the server. When the presenter ends the
session, every screen switches to ended immediately. Live updates must work across two backend instances through Redis,
and a missed event must never cause wrong data because clients re-fetch state.

## What it does
Once a person opens a session page, their screen stays connected to the server. The presenter's dashboard shows the
number of people in the session right now, and that number changes as people arrive and leave. When the presenter ends
the session, every connected screen changes to the ended state within a moment, without a refresh. If the connection
drops, the screen reconnects by itself and loads the latest state. If the app runs on more than one server, a change
made through one server still reaches screens connected to another.

## Who uses it
- **Presenter** — sees the live count of people connected, and sees the session end on their own dashboard.
- **Participant** — sees the ended state immediately when the presenter ends; recovers from a dropped connection.
- **Operator** — can see whether live updates are degraded because the shared message channel is down.

## User stories
1. As a presenter, I want to see how many people are connected right now so that I know my audience is here.
2. As a participant, I want my screen to update by itself when the session ends so that I don't have to refresh.
3. As a participant, I want my screen to recover after my connection drops so that I don't miss the current state.
4. As a presenter, I want my dashboard to stay correct when several servers run so that I don't see stale counts.
5. As an operator, I want to know when live updates are degraded so that I can act before the audience notices.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | A presenter or participant with a valid session credential connects and is placed in that session's live group | Credentials are the same HttpOnly cookies from the previous phase |
| 2 | A connection without a valid credential is refused | Refused connection gets a clear, generic error; nothing about the session is revealed |
| 3 | A connection can only receive updates for the session it is authorised for | Guessing another session's id gives nothing |
| 4 | The presenter's dashboard shows how many distinct participants are connected right now | Two tabs from one person count once; the presenter is not counted |
| 5 | The count goes down when a participant's last connection closes | Within a short grace period, so a quick refresh does not flicker the count |
| 6 | When the session ends, every connected screen shows the ended state at once | Participants and presenter alike |
| 7 | After a reconnect, the screen loads the current session state from the server | Redis does not replay missed messages; the state fetch repairs the screen |
| 8 | Updates reach screens connected to a different server instance | Verified with two servers and one shared Redis |
| 9 | If the shared message channel is down, the server reports degraded live updates | Durable data is unaffected; `/ready` shows the degraded state |
| 10 | Live updates do not carry the presenter key, cookies, tokens or internal database details | Only the data each audience member is allowed to see |
| 11 | The server shuts down cleanly: connected screens are told to reconnect and the message channel is closed | Shutdown finishes within a time limit |

## User flows
### Flow 1: Presenter sees the live count
1. Presenter opens the dashboard for their session.
2. A participant joins from another device.
3. The dashboard count goes from 0 to 1 without a refresh.
4. The participant closes the page; the count goes back to 0 after a short grace period.

### Flow 2: Session ends while people are watching
1. Several participants have the session page open.
2. Presenter ends the session.
3. Every participant screen shows "This session has ended" immediately.
4. New joins are refused, as before.

### Flow 3: Connection drops and returns
1. A participant's phone loses signal for a minute.
2. The screen shows "Reconnecting…".
3. When signal returns, the screen reconnects and loads the current session state.
4. If the session ended during the outage, the screen shows the ended state.

### Flow 4: Shared channel outage
1. The shared message channel stops while the session is running.
2. Presenter and participant screens keep working; the dashboard shows "Live updates may be delayed. Refresh if numbers look wrong."
3. When the channel comes back, live updates resume and the screen refetches state.

### Edge cases
- The same person opens three tabs → one participant counted; closing two tabs keeps the count.
- Presenter opens the dashboard on two devices → presenter is not counted as a participant.
- The session ends while a participant is reconnecting → after reconnect, the ended state appears.
- A participant's credential is valid for session A but they try to listen to session B → refused.
- The server restarts → all screens reconnect and refetch; durable data is intact; the count rebuilds from current connections.

## Real-time behaviour
- Live: presenter participant count; session ended; session error notices.
- On reconnect: the screen always refetches the current state over HTTP. The live channel is never the only source of truth.
- Participant screens never receive presenter-only information.

## Scope
**In scope**
- Live connection for presenter and participants, authorised per session.
- Live participant count for the presenter (distinct participants, short grace period on disconnect).
- Live "session ended" notice to everyone in the session.
- Reconnect that refetches the current session state (new snapshot endpoint).
- Cross-instance delivery through a shared Redis channel (two-instance proof).
- Degraded-mode reporting when the shared channel is down.
- Clean shutdown of connections and the shared channel.
- Client-side reconnect state on the session and dashboard pages.

**Out of scope**
- Polls, votes, word cloud, Q&A, reactions — later phases (they will reuse this backbone).
- Presenter commands over the live channel — presenter actions stay on HTTP for this phase.
- Durable replay of missed messages (not supported by design; refetch instead).
- Accounts, sign-in or new credential types.
- Production load balancer and sticky-session configuration.

## Assumptions
1. Credentials are the existing session cookies. Reason: consistent with the previous phase and not readable by page scripts. Developer chose this.
2. "Connected" counts distinct participants, not open tabs. Developer chose this.
3. When the shared channel is down, the server keeps serving with degraded live updates and does not drop sockets. Developer chose this.
4. A short grace period (about 5 seconds) before a disconnect lowers the count, so brief refreshes do not flicker it. Reason: avoids noisy counts on refresh; value can be tuned.
5. The presenter is not counted as a participant. Reason: the requirement counts audience members.
6. Presenter actions stay on HTTP. Reason: documented decision in the architecture docs; keeps authorisation in one place.
7. Snapshot contents for this phase are session status, title, room code and the joined and connected counts. Polls and other content join later. Reason: those features do not exist yet.

## Risks
- **HIGH**: Connections authorised by cookie could be hijacked across sites. Impact: a stranger receives live data. Mitigation: origin check on the handshake, HttpOnly and SameSite cookies, per-session scope.
- **HIGH**: Presence counts are per server process if tracked in memory. Impact: wrong count with two servers. Mitigation: counts derived from the shared channel and verified by a two-server test.
- **MEDIUM**: Missed events during a reconnect show stale data. Impact: a screen looks wrong briefly. Mitigation: refetch on every reconnect.
- **MEDIUM**: Many simultaneous connections exhaust memory or file handles. Impact: slow or failed sessions. Mitigation: per-IP connection limit and a cap per session.
- **LOW**: Grace-period timing differs across devices. Impact: slightly delayed count changes. Mitigation: documented, tunable value.

## Non-functional requirements (user-facing)
- A participant's screen reflects "session ended" within 2 seconds of the presenter ending it, on a normal connection.
- The presenter's count updates within 2 seconds of a join or leave.
- A screen reconnects automatically after a dropped connection, with no user action.
- Nothing in the live channel reveals another session's data.

## Success criteria
1. A participant with a valid credential connects, and the presenter's count shows 1 after joining.
2. A connection without a valid credential is refused and receives no session data.
3. Two tabs from one participant count as 1; closing one tab keeps the count at 1; closing both lowers it to 0 after the grace period.
4. When the presenter ends the session, every connected participant screen shows the ended state within 2 seconds.
5. After a dropped connection, the screen reconnects and shows the current state without a refresh.
6. With two server instances on one shared channel, an event produced on one instance reaches a client connected to the other.
7. When the shared channel is stopped, `/ready` reports degraded live updates; durable actions still work; when it returns, live updates resume.
8. Stopping the server closes connections and the shared channel within the time limit.
9. Live messages contain no presenter key, cookie, token or database detail (checked by inspecting every message type).

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-24 | Created and confirmed (Redis outage keeps serving degraded; count = distinct participants; socket auth = session cookies) |
