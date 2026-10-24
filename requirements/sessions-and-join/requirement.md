# Feature: Sessions and joining

## Metadata
- **Name**: sessions-and-join
- **Status**: completed
- **Current phase**: initial
- **Created**: 2026-10-24 · **Last updated**: 2026-10-24
- **Parent** (enhancements only): n/a

## Original request
Phase 3 of the LivePulse roadmap (`docs/08-implementation-plan.md`): presenter creates a live session with a title
and optional description, and receives a short unique room code, a join link and a private presenter key shown only
once. A participant opens the join page, enters the room code and a display name, and receives a private participant
identity for that session only; refreshing the page keeps them in the session. Presenter-only pages and actions
require the presenter key. Ended sessions cannot be joined. Room code is discovery, not authorization. Include
landing, create and join pages with all loading/error/empty states.

## What it does
A presenter starts a session and gets a code the audience can type. Audience members join from their own phones or
laptops with the code and a name. Each person is recognised by the app on later visits in the same browser. The
presenter sees the session on a dashboard, and only the presenter can see or change session details. Once the
presenter ends the session, nobody can join it.

## Who uses it
- **Presenter** — creates the session, shares the code, watches the session status and participant count, ends it.
- **Participant** — joins with the code and a name, and keeps that identity when refreshing the page.
- **Visitor** — anyone who opens the landing page; can create a session or go to the join page.

## User stories
1. As a presenter, I want to create a session with a title so that my audience has something to join.
2. As a presenter, I want a short code and a join link so that people can get in quickly.
3. As a presenter, I want to keep my session private to me so that strangers cannot run it.
4. As a participant, I want to join with a code and my name so that I can take part from my own device.
5. As a participant, I want my place to survive a page refresh so that I don't have to rejoin.
6. As a presenter, I want to end the session so that no new people can join or respond.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | Creating a session needs only a title; description is optional | Title 1–80 characters after trimming; description up to 500 |
| 2 | Creating a session shows the room code, join link and presenter key once | The key cannot be shown again; the presenter is told to save it |
| 3 | The creating browser is recognised as the presenter for that session | No key needed again in that browser |
| 4 | The presenter can open the session on another device by entering the presenter key once | Wrong key shows a clear error; nothing else is revealed |
| 5 | Room codes are unique and use no look-alike characters | 6 characters from a 31-character set without 0, O, 1, I, L |
| 6 | Joining needs a valid room code and a display name | Display name 1–30 characters after trimming |
| 7 | Joining an unknown or ended session shows the same generic "not found or not open" message | Avoids telling guessers which codes exist |
| 8 | A participant keeps their identity in a browser for that session only | Other sessions cannot use it |
| 9 | Refreshing the page restores the participant's view of the session | No second join created |
| 10 | Public session lookup shows only title, status and code | Never the presenter key, participant list or internal IDs |
| 11 | The presenter dashboard shows status, title, code, join link and the count of people who have joined | Count is of people who joined, not who is online right now |
| 12 | Ending a session is final | Ended sessions reject new joins; ending twice is harmless |
| 13 | Repeated join attempts from one source are limited | A clear "too many attempts, try again shortly" message |

## User flows
### Flow 1: Presenter creates a session
1. Presenter opens the landing page and chooses Create session.
2. Presenter enters a title (and optionally a description) and submits.
3. The page shows the room code, the join link and the presenter key, with a warning that the key is shown once.
4. Presenter goes to the presenter dashboard for the session.

### Flow 2: Participant joins
1. Participant opens the join page (or the join link, which pre-fills the code).
2. Participant enters the room code and a display name, and submits.
3. The participant lands in the session view for that code.
4. If the participant refreshes, they stay in the session with the same identity.

### Flow 3: Presenter returns from another device
1. Presenter opens the presenter page for the session on a new device.
2. The page asks for the presenter key.
3. After a correct key, the presenter sees the dashboard. A wrong key shows a clear error and reveals nothing.

### Flow 4: Presenter ends the session
1. Presenter chooses End session and confirms.
2. The dashboard shows the ended state.
3. New join attempts with the code are refused with the generic message.

### Edge cases
- Two people try the same display name → allowed (names are not unique).
- The room code collides with an existing one → the system retries a few times, then shows a safe error.
- Joining with a session code that has ended → generic "not found or not open" message.
- Presenter key pasted with spaces → accepted after trimming.
- Participant opens the join link after the session ended → clear ended message on the join page.

## Real-time behaviour
None in this phase. The presenter's count and status update on page refresh. Live updates arrive in the
realtime-backbone phase.

## Scope
**In scope**
- Landing page with Create session and Join session.
- Session creation with title and optional description; room code; join link; presenter key shown once.
- Presenter recognised in the creating browser; presenter key entry on other devices.
- Presenter dashboard: title, status, code, join link, joined count, End session.
- Joining with room code and display name; per-session participant identity kept in the browser.
- Public session lookup (title, status, code only).
- Ending a session (final).
- Rate limits on creating, joining and presenter-key entry.
- Loading, empty, validation-error, server-error and ended states on every page.

**Out of scope**
- Live (real-time) presence and live updates — realtime-backbone phase.
- Polls, votes, word cloud, Q&A, reactions — later phases.
- Reopening an ended session.
- User accounts, sign-in, or any identity verification of people.
- Editing the title after creation.
- Removing participants.
- Final results page — later phase.

## Assumptions
1. Presenter identity is a secure, session-scoped cookie set at creation, plus the presenter key entered once on
   another device. Reason: the key never lives in a URL or in page-readable storage. (Technical detail for the
   plan: `docs/04` and `docs/06` describe a bearer-header presenter key; they will be updated to match.)
2. Participant identity is a secure, session-scoped cookie. Reason: page scripts cannot read it.
3. Room code: 6 characters from a 31-character set with no look-alikes. Reason: about 10^9 combinations is hard to
   guess with rate limits. Developer chose this.
4. Ended sessions are final for the MVP. Developer chose this.
5. The dashboard count is of people who joined (registered), not live presence. Reason: live presence arrives with
   realtime. Developer should confirm this label is acceptable.
6. Rate limits: 10 session creations per IP per hour; 20 join attempts per IP per minute; 10 presenter-key
   attempts per session per 15 minutes. Reason: sensible defaults; can be tuned in configuration.
7. Names may repeat. Reason: no accounts, so uniqueness adds friction with no security gain.

## Risks
- **HIGH**: Room codes are discoverable and can be guessed in bulk. Impact: strangers join private sessions.
  Mitigation: strong random codes, join rate limit, generic error, presenter-only pages still require the key.
- **HIGH**: Presenter key leaks (logs, screenshots, shared links). Impact: someone else controls the session.
  Mitigation: shown once, never logged, never in URLs, cookie-based access.
- **MEDIUM**: Cookies don't work across the web and API ports in some browsers. Impact: refresh loses identity.
  Mitigation: same-site setup on localhost; verified during build.
- **MEDIUM**: Presenter loses the key before a second device. Impact: no way back in. Mitigation: clear warning and a
  copy button; the cookie keeps the creating browser working.
- **LOW**: Display names may be offensive. Mitigation: out of scope here; moderation arrives with Q&A.

## Non-functional requirements (user-facing)
- A participant reaches the session view within 2 seconds on a normal connection.
- The join page works on a phone screen with a visible focus outline and labelled inputs.
- No page shows a stack trace or internal error text.

## Success criteria
1. A presenter creates a session and sees a unique room code, join link and presenter key, once.
2. Two separate browsers can join the same session with the code and different names.
3. Refreshing a participant's page keeps them in the session with the same identity; a second browser does not.
4. An invalid room code shows a validation or not-found message without revealing other sessions.
5. The presenter dashboard shows the correct joined count after two people join.
6. The presenter page refuses access without the presenter key from a new browser, and accepts the correct key.
7. After ending, joining with the code is refused with the generic message, and ending again changes nothing.
8. Rate limits return a "too many attempts" message.
9. The public lookup never returns the presenter key or participant list.
10. The presenter key does not appear in any URL, log line or error response.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-24 | Created and confirmed (presenter cookie + key on other devices; participant cookie; 6-character codes; ending is final) |
| 2026-10-24 | Completed. Success criteria 1–10 covered by automated tests (58 integration, 35 web, 49 unit) and a 12-step HTTP flow. Not verified in a real browser: cookies across ports, clipboard, end-confirmation click flow. See planning-tracking.md Issues. |
