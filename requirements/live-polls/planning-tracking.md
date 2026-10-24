# live-polls — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Live polls

### Architecture
```
DB:  polls, poll_options, votes (one additive migration).
     One open poll per session = partial unique index WHERE status='ACTIVE'.
API: /api/sessions/:id/polls, /api/polls/:id/{start,close,votes}, PATCH /api/polls/:id,
     GET /api/sessions/:id/polls (presenter), GET /api/sessions/by-code/:code/polls/current (participant)
Realtime: poll:started, poll:closed, poll:updated → session room; poll:results → presenter room when hidden,
     session room when shown. Emitted after commit from api/src/realtime/polls.ts.
Web: presenter page → PollsPanel; participant page → ParticipantPoll; useSessionSocket gains the poll events.
```

### DB tables
| Table | Columns | Constraints and indexes |
|---|---|---|
| polls | id, session_id, question varchar(200), status enum (DRAFT, ACTIVE, CLOSED), show_results bool default true, closed_at, timestamps | FK session → sessions CASCADE. CHECK (status='CLOSED') = (closed_at IS NOT NULL). CHECK non-empty question. **Partial unique index `polls_one_active_per_session` ON polls(session_id) WHERE status='ACTIVE'**. Index (session_id, created_at) |
| poll_options | id, poll_id, label varchar(80), position smallint 0–5, timestamps | FK poll → polls CASCADE. Unique (poll_id, position). Unique (poll_id, label). **Unique (id, poll_id)**. CHECKs on position and non-empty label |
| votes | id, poll_id, option_id, participant_id, created_at | **Unique (poll_id, participant_id)**. **Composite FK (option_id, poll_id) → poll_options(id, poll_id) CASCADE** (raw SQL). FK participant → participants CASCADE. Index (poll_id, option_id) |

The one-open-poll rule is enforced by the database: a second start cannot commit. The service turns that into
`409 POLL_ALREADY_ACTIVE`; the code pre-check only gives a friendlier message.

### Key decisions
1. Votes are HTTP (not a socket command): reuses cookie auth, rate limits and the error envelope.
2. Lock order, session row before poll row: votes take `FOR SHARE` on the poll; start, close and the show-results
   switch take `FOR UPDATE`; end takes the session `FOR UPDATE` and then closes the poll. Concurrent votes do not
   block each other; close waits for votes already in flight. **docs/02 says votes take `FOR UPDATE`; it is updated.**
3. Version = total vote count (votes are final, so it only grows). Clients drop any update not newer.
4. Vote-count broadcasts are combined per poll (~250 ms) and read counts and `show_results` fresh from the database at send time.
5. Clients refetch over HTTP on `poll:started`, `poll:closed`, `poll:updated`, and on every connect. Only `poll:results` is applied directly.
6. Closing a closed poll returns 200 unchanged (retries are harmless).
7. The docs/04 `GET /polls/:id/results` is replaced by the presenter list and the participant current-poll endpoint.

### Contracts: HTTP (all under /api; POSTs pass the origin check)
| Method / path | Who | Body → success | Errors |
|---|---|---|---|
| POST /sessions/:id/polls | Presenter | `{ question, options[2–6], showResults? = true }` → 201 PresenterPoll (DRAFT) | 400 (lengths, count, empty, duplicate labels: trimmed, case-insensitive), 401, 404, 409 SESSION_ENDED, 409 POLL_LIMIT_REACHED (50 per session), 429 |
| GET /sessions/:id/polls | Presenter | → 200 `{ polls }` with results | 401, 404 |
| POST /polls/:id/start | Presenter of the poll's session | → 200 PresenterPoll | 401, 404, 409 SESSION_ENDED, 409 POLL_NOT_DRAFT, 409 POLL_ALREADY_ACTIVE |
| POST /polls/:id/close | Presenter | → 200 PresenterPoll (200 unchanged if already closed) | 401, 404, 409 POLL_NOT_ACTIVE (draft) |
| PATCH /polls/:id | Presenter | `{ showResults }` → 200 PresenterPoll (allowed on CLOSED polls — Decision Q1) | 400, 401, 404 |
| POST /polls/:id/votes | Participant of the poll's session | `{ optionId }` → 201 `{ pollId, myOptionId }` | 400 INVALID_OPTION, 401, 404 (also drafts), 409 POLL_NOT_ACTIVE, 409 VOTE_ALREADY_RECORDED, 429 (300/min/IP) |
| GET /sessions/by-code/:code/polls/current | Participant | → 200 `{ poll: ParticipantPoll \| null }` (open poll, else last closed) | 401, 404 |

DTOs: `PollResults = { total, version, options: [{id, count, pct}] }`;
`PresenterPoll = { id, question, status, showResults, closedAt, options, results }`;
`ParticipantPoll = { id, question, status, showResults, closedAt, options, myOptionId, results | null }`.
**Per-recipient rule:** `results` is `null` whenever `showResults` is false; one participant mapper decides this.

Ownership: each `/polls/:id` route loads the poll, takes `sessionId` from that row (never from the request), and checks
the cookie for that session.

### Contracts: socket events (server → client)
| Event | Room | Payload | Receives |
|---|---|---|---|
| poll:started | session | `{ poll: { id, question, options, showResults } }` (no counts) | everyone |
| poll:closed | session | `{ pollId, closedAt }` | everyone (also when ending closes a poll) |
| poll:updated | session | `{ pollId, showResults }` | everyone (clients refetch) |
| poll:results | presenter room when hidden, session room when shown | `{ pollId, total, version, options }` | presenter always; participants only when shown |

### Files
| File | C/M | Purpose | Risk |
|---|---|---|---|
| shared/src/schemas/polls.ts (+ test), shared/src/index.ts | C/M | Zod bodies, DTOs | MEDIUM |
| shared/src/events/realtime.ts (+ test) | M | four events | MEDIUM |
| api/migrations/<generated>-create-polls-and-votes.cjs | C | tables, constraints, down with destructive warning | HIGH |
| api/src/models/{poll,poll-option,vote}.model.ts, models/index.ts | C/M | models, associations | MEDIUM |
| api/src/services/polls.service.ts, votes.service.ts | C | rules, locks, results, mappers | HIGH |
| api/src/services/sessions.service.ts | M | endSession closes the open poll; returns `{ session, closedPoll }` | HIGH |
| api/src/realtime/polls.ts, realtime/index.ts, shutdown.ts | C/M | emitters, combined vote counts, timer cleanup | HIGH |
| api/src/controllers/polls.controller.ts, routes/polls.routes.ts, app.ts, sessions.controller.ts | C/M | wiring, emit after commit, limiters | MEDIUM |
| api/tests/helpers/{test-app,realtime-harness,truncate}.ts | M | stub emitters; list new tables | LOW |
| api/tests/integration/polls*.test.ts, votes-concurrency.test.ts, api/tests/realtime/poll-*.test.ts | C | behaviour, races, secrecy | HIGH |
| web/src/lib/api/polls.ts, web/src/realtime/{session-socket-state,use-session-socket}.ts | C/M | client, poll events | MEDIUM |
| web/src/hooks/{use-presenter-polls,use-participant-poll}.ts | C | snapshot plus live merge by version | MEDIUM |
| web/src/components/polls/{PollsPanel,CreatePollForm,PollResults,ParticipantPoll}.tsx (+ tests); presenter page; ParticipantClient | C/M | UI | MEDIUM |
| docs/02, 03, 04, 05 | M | contracts, lock order | LOW |

### Impact analysis
- **Breaking:** `endSession` returns `{ session, closedPoll }` (controller and tests). `initModels` gains three models.
  `AppRealtime` gains poll emitters (test fakes). Events are additive.
- **Migration / rollback:** one additive migration. Down is destructive (deletes poll and vote data): needs the same
  warning as the sessions migration; approval required before running it where real data exists.
- **Concurrency:** lock order is always session before poll; no transaction locks a poll and then a session. The
  duplicate-vote `UniqueConstraintError` is caught outside the transaction callback, because it aborts the transaction.
  Results are read after commit.
- **Security:** hidden results never leave the server (one participant mapper; the vote-count room is chosen from a fresh
  read). Residual: a few milliseconds when hiding mid-poll (accepted, Q2, with a test). Drafts are 404 to participants.
  No voter identities in any payload. Zod limits every body; rate limits on create and vote.
- **Testing (real Postgres):** duplicate vote → 1 row; two tabs → 1 row; two participants → 2 rows; vote vs close (test
  holds the poll `FOR UPDATE`, the vote waits and is refused, and the reverse order); end vs vote; two starts → one
  success and one 409; secrecy (hidden: no `poll:results` to participants, `results: null` in every participant
  response); cross-session 401/404.

### Edge cases
Double tap / two tabs → one vote · second poll while one is open → 409 · create or start after end → 409 SESSION_ENDED ·
vote on closed → 409, client refetches · show-results switch while open → poll:updated and refetch · duplicate labels
refused · reload shows `myOptionId` and disables voting · late joiner gets the open poll from current-poll · total 0 → 0%
· percentages rounded, counts shown beside them · end while a poll is open closes it (poll:closed).

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Shared poll schemas and DTO types | MEDIUM | executor-medium | verified | verified; shared 59 tests (13 poll schema, 3 event) |
| 2 | Shared poll event schemas and event map | LOW | executor-low | verified | verified; poll event schemas |
| 3 | Migration (generated) with constraints and partial index | HIGH | executor-high | verified | verified; up/down/up on test DB; 4 constraint probes raised expected errors |
| 4 | Models, associations, `Models` type, truncate helper | MEDIUM | executor-medium | verified | verified; 5 poll model tests |
| 5 | polls.service: create, list, current, start, close, show-results switch, results, mappers | HIGH | executor-high | verified | verified; 10 polls-service tests; lock order session then poll |
| 6 | votes.service `castVote` | HIGH | executor-high | verified | verified; castVote; concurrency 5 tests (duplicate, two tabs, two voters, vote vs close) |
| 7 | `endSession` closes the open poll | HIGH | executor-high | verified | verified; endSession closes open poll; closed_at now clock_timestamp() after lock wait; 5 end tests |
| 8 | Realtime poll emitters, combined vote counts, shutdown cleanup, test stubs | HIGH | executor-high | verified | verified; realtime poll emitters, combined counts, fresh reads; 7 realtime tests |
| 9 | Controller, routes, limiters, emits after commit, poll:closed on end | MEDIUM | executor-medium | verified | verified; 16 route tests; voter must belong to poll session; limiters 60 create / 300 vote |
| 10 | Cross-cutting secrecy and two-starts tests | HIGH | executor-high | verified | verified; secrecy (hidden results never reach participants) and race tests; races 5x clean |
| 11 | Web API client, socket reducer and hook additions, poll hooks | MEDIUM | executor-medium | verified | verified; web client, reducer, hooks, merge rule; 88 web tests total |
| 12 | Presenter PollsPanel, create form, results (counts and %, aria-live polite) | MEDIUM | executor-medium | verified | verified; PollsPanel, CreatePollForm, PollResults; build ok; not seen in a browser |
| 13 | Participant poll view (large buttons, recorded, closed and hidden states) | MEDIUM | executor-medium | verified | verified; ParticipantPoll; reload shows chosen option; not seen in a browser |
| 14 | Docs 02, 03, 04, 05 and tracking | LOW | executor-low | verified | verified; docs 02, 03, 04, 05 updated (english) |

## Execution groups
| Group | Tasks | Executor |
|---|---|---|
| G1 | 1, 2 | executor-medium, then executor-low |
| G2 | 3 | executor-high |
| G3 | 4 | executor-medium |
| G4 | 5, 6, 7 | executor-high |
| G5 | 8 | executor-high |
| G6 | 9 | executor-medium |
| G7 | 10 | executor-high |
| G8 | 11, 12, 13 | executor-medium |
| G9 | 14 | executor-low |

## Approval
- Plan v1 approved by the developer on 2026-10-24. Execution started.

## Approvals needed
- **New packages:** none.
- **Destructive down migration:** approval needed before running it where real data exists (test DB only until then).

## Decisions (answered 2026-10-24)
- Q1: the show-results switch can change after a poll closes (reveal after close). Poll content stays fixed.
- Q2: accept the few-millisecond hide race, with a test.
- Q3: a duplicate vote returns 409 `VOTE_ALREADY_RECORDED`.
- Q4: vote rate limit 300 per minute per IP.
- Defaults taken (not asked): 50 polls per session; participants see the last closed poll when none is open.

## Issues & updates
- **2026-10-24 · HIGH · Dev DB missing poll tables:** poll creation returned 500 (`relation "polls" does not exist`) until the forward migration was applied to the dev database. Resolved.
- **2026-10-24 · MEDIUM · Close time ordering:** when a session ended during an in-flight vote, `closed_at` was set before the wait, so a vote could be later than the close time. Resolved: `clock_timestamp()` after the lock wait.
- **2026-10-24 · LOW · Unexplained race failure:** one early run of the race file failed and its output was lost. Five later runs and the full suite passed. Not reproduced.
- **2026-10-24 · LOW · Session check in vote service:** castVote does not check the session; the route does. Votes after end return POLL_NOT_ACTIVE, not SESSION_ENDED.
- **2026-10-24 · NOT VERIFIED:** how the poll UI looks and behaves in a real browser (components built and tested, no browser run); live polls in a real browser.

<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-24 | plan_created | Plan v1 drafted by planner; decisions Q1–Q4 answered; awaiting plan approval | planning-tracking.md |
| 2026-10-24 | approval | Plan v1 approved; destructive down migration only on test DB | planning-tracking.md |
| 2026-10-24 | build | Tasks 1–14 built in groups; each verified with real exit codes | api/, shared/, web/, docs/02-05 |
| 2026-10-24 | verify | Full run: lint 0, typecheck 0, unit 59+52+88, web build 0, prettier 0, integration 172/172; live e2e 22/22 | — |
