# live-qna — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Live Q&A

### Architecture
```
DB:  sessions.qna_open (new column, additive) · questions · question_upvotes (two migrations).
     Upvote count is COUNTED from question_upvotes, not stored.
API: POST /sessions/by-code/:code/questions · GET /sessions/by-code/:code/questions (participant)
     GET /sessions/:id/questions (presenter) · POST /questions/:id/upvotes · PATCH /questions/:id
     PATCH /sessions/:id/settings { qnaOpen }
Realtime: question:created | question:updated | qna:status → session room;
     question:upvotes → session room (combined ~250 ms, visible questions only, read fresh).
Web: presenter page → QnaPanel; ParticipantClient → LiveParticipantQna.
```

### DB tables
| Table | Columns | Constraints and indexes |
|---|---|---|
| sessions (ALTER) | `qna_open` boolean NOT NULL DEFAULT true | Backfill false where ENDED. CHECK: status='ACTIVE' OR qna_open=false |
| questions | id, session_id, participant_id, text varchar(200), text_key varchar(400), hidden, pinned, answer_text varchar(500) null, answered_at null, timestamps | FKs CASCADE. CHECK text not blank; answer null or not blank; CHECK NOT (pinned AND hidden). Partial unique `questions_one_pinned_per_session` (session_id) WHERE pinned. Unique `questions_participant_text_key` (participant_id, text_key). Index (session_id, created_at) |
| question_upvotes | id, question_id, participant_id, created_at | Unique (question_id, participant_id). FKs CASCADE |

Answered = `answered_at` not null. `answer_text` is separate, so a new answer replaces the old one.

### Key decisions
1. **Lock order: session → participant → question → upvote row.** Nothing locks in reverse.
   - Submit: session FOR SHARE (refuse if ENDED or Q&A closed) → participant FOR NO KEY UPDATE → count this
     participant's questions → insert. Five-question cap: the participant row lock makes a second submit from the same
     participant wait; the COUNT then sees the committed row (READ COMMITTED). NO KEY UPDATE does not block KEY SHARE
     locks taken by foreign-key checks.
   - Upvote: session FOR SHARE → question FOR SHARE (unknown, hidden or other session → 404; own question → 403).
   - Q&A switch and end: session FOR UPDATE. End also sets `qna_open=false`.
   - Pin: session FOR UPDATE → question FOR UPDATE → unpin any other question → pin this one (replaces the pin).
   - Hide, restore, answer: question FOR UPDATE.
2. **Counted upvotes.** `COUNT(*)` over question_upvotes; no counter column (a stored counter would make two upvoters
   deadlock on the question row). docs/03 is updated.
3. **Close vs submit.** The switch waits for in-flight submits; a waiting submit re-reads the locked session and gets
   409 `QNA_CLOSED`. End vs submit: 409 `SESSION_ENDED` (checked before `QNA_CLOSED`).
4. **One order for every screen:** `ORDER BY pinned DESC, upvotes DESC, created_at ASC, id ASC`. The browser never re-sorts.
5. **Who sees what:** participant list uses `WHERE hidden = false` and one mapper `toParticipantQuestion` (adds `mine`,
   `myUpvote`; no participant id). Before sending `question:created`, re-read; send nothing if now hidden.
   Hidden questions cannot be upvoted, so their counts never change. The presenter sees them over HTTP only.
6. **Q&A switch:** `PATCH /sessions/:id/settings { qnaOpen }`. Opening an ended session → 409 SESSION_ENDED; closing → 200 unchanged.
7. **Moderation after end** (hide, answer) is allowed.
8. **Rate limits:** submit 120/min/IP; upvote 300/min/IP. The 5-question cap is the real limit.
9. **Retries (Q1 — confirmed):** same text again by the same participant → 409 `QUESTION_ALREADY_ASKED` (unique key).
10. **Q&A open by default (Q2 — confirmed).** Column default true.
11. **Pin replaces the current pin (Q3 — confirmed).**
12. **Answers are one line (Q5 — confirmed):** same rule as questions (trim, 1–500 characters, no control characters).

### Contracts: HTTP (POST and PATCH pass the origin check)
| Method / path | Who | Body → success | Errors |
|---|---|---|---|
| POST /sessions/by-code/:code/questions | Participant (cookie before body) | `{ text }` → 201 `{ question }` | 400 (field text), 401, 404, 409 SESSION_ENDED / QNA_CLOSED / QUESTION_LIMIT_REACHED (5) / QUESTION_ALREADY_ASKED, 429 |
| GET /sessions/by-code/:code/questions | Participant | → 200 `{ qnaOpen, questions }` | 401, 404 |
| GET /sessions/:id/questions | Presenter | → 200 `{ qnaOpen, questions }` (includes hidden) | 401, 404 |
| POST /questions/:id/upvotes | Participant of the question's session (cookie before body) | → 201 `{ questionId, myUpvote: true }` | 401, 403 OWN_QUESTION, 404 (unknown, hidden, other session), 409 SESSION_ENDED / QNA_CLOSED / UPVOTE_ALREADY_RECORDED, 429 |
| PATCH /questions/:id | Presenter of the question's session | `{ hidden?, pinned?, answered?, answerText? }`, at least one → 200 | 400 (field names), 401, 404 |
| PATCH /sessions/:id/settings | Presenter | `{ qnaOpen }` → 200 `{ qnaOpen }` | 400, 401, 404, 409 SESSION_ENDED |

DTOs: `PublicQuestion = { id, text, upvotes, pinned, answered, answerText, answeredAt, createdAt }`;
`ParticipantQuestion = PublicQuestion & { mine, myUpvote }`; `PresenterQuestion = PublicQuestion & { hidden }`.
Ownership: every `/questions/:id` route takes sessionId from the row.

### Contracts: socket events (server → client)
| Event | Room | Payload | Client action |
|---|---|---|---|
| question:created | session | `{ question: PublicQuestion }` (read fresh; skipped if hidden) | Append (newest, 0 upvotes) |
| question:upvotes | session | `{ version, questions: [{ id, upvotes }] }` visible only, server order | Apply if version newer (version = total upvote rows) |
| question:updated | session | `{ questionId }` | Refetch |
| qna:status | session | `{ open }` | Refetch |

Clients also refetch on every connect and on session:ended. No payload contains a participant id, name, or voters.

### Files
| File | C/M | Purpose | Risk |
|---|---|---|---|
| shared/src/schemas/qna.ts (+ test), shared/src/index.ts | C/M | text rules, bodies, DTOs, textKey | MEDIUM |
| shared/src/events/realtime.ts (+ test) | M | four events | MEDIUM |
| api/migrations/<generated>-add-qna-open-to-sessions.cjs | C | column, backfill, CHECK | HIGH |
| api/migrations/<generated>-create-questions-and-upvotes.cjs | C | tables, constraints; down deletes data | HIGH |
| api/src/models/{question,question-upvote}.model.ts, session.model.ts, models/index.ts | C/M | models, qnaOpen, associations | MEDIUM |
| api/src/services/questions.service.ts, question-upvotes.service.ts | C | locks, cap, ordering SQL, mappers | HIGH |
| api/src/services/sessions.service.ts | M | setQnaOpen; endSession closes Q&A | HIGH |
| api/src/realtime/questions.ts, realtime/index.ts, server.ts, shutdown.ts | C/M | senders, combined upvotes, timers | HIGH |
| api/src/controllers/questions.controller.ts, routes/questions.routes.ts, sessions controller/routes, app.ts | C/M | wiring, limiters, sends after commit | MEDIUM |
| api/tests/helpers/{test-app,realtime-harness,truncate}.ts | M | stubs, new tables | LOW |
| api/tests/integration/qna-*.test.ts, api/tests/realtime/qna-*.test.ts | C | behaviour, races, secrecy | HIGH |
| web/src/lib/api/questions.ts, web/src/realtime/{session-socket-state,use-session-socket}.ts | C/M | client, events | MEDIUM |
| web/src/hooks/{use-presenter-questions,use-participant-questions,questions-merge}.ts (+ test) | C | snapshot plus live merge | MEDIUM |
| web/src/components/qna/*.tsx/.ts (+ tests); presenter page; ParticipantClient | C/M | UI | MEDIUM |
| docs/03, 04, 05, 07 | M | contracts, lock order, counted upvotes | LOW |

### Impact analysis
- **Breaking:** Session model gains `qnaOpen`; `endSession` also closes Q&A; `Realtime` gains senders (test fakes change);
  `initModels` gains two models. docs/04 (`/upvotes`) and docs/05 (no socket commands) change. Events additive.
- **Migrations / rollback:** (1) add-qna-open-to-sessions: additive; down drops the column (loses the switch state only).
  (2) create-questions-and-upvotes: down **deletes all Q&A data** — test database only until approved.
- **Concurrency:** duplicate questions and upvotes stopped by unique keys (errors caught outside the transaction callback).
  Cap race: six parallel submits from one participant → exactly five. Pin race: the session lock serialises pins; the
  partial unique index is the backstop.
- **Security:** hidden questions never leave the server (one SQL filter, one mapper, fresh read before sending). Text is
  React text nodes only. Cross-session upvotes refused. PATCH routes check the presenter cookie. Residual: a few
  milliseconds between create commit and hide (accepted, with a test).
- **Testing (real Postgres):** cap race (6 → 5), retry (same text twice → 1 row, 409), upvote race (two tabs → 1 row),
  own question → 403, pin race (two pins → one pinned), close vs submit and end vs submit in both orders, secrecy
  (hidden absent from every participant response and socket message; restore brings it back with its upvotes), markup
  literal, ordering ties by created_at then id.

### Edge cases
Double tap or two tabs → one upvote, 409 · reload → `mine`, `myUpvote` from the server · upvote on hidden → 404 ·
hiding a pinned question unpins it · answering a hidden question allowed · `answerText: null` clears the answer ·
closed Q&A keeps the list visible · end closes Q&A for good · invisible-only text → 400 · no pagination (prototype limit).

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Shared Q&A schemas, textKey, bodies, DTOs | MEDIUM | executor-medium | verified | verified; Q&A schemas, text key, bodies, DTOs; shared 100 tests |
| 2 | Shared question and qna event schemas | LOW | executor-low | verified | verified; question and qna event schemas |
| 3 | Two generated migrations | HIGH | executor-high | verified | verified; two migrations; up/down/up on test DB; probes raised expected errors |
| 4 | Models, Session.qnaOpen, associations, truncate helper | MEDIUM | executor-medium | verified | verified; Q&A models; Session.qnaOpen; 5 model tests |
| 5 | questions.service: submit (locks + cap), lists (SQL order, mappers), moderate | HIGH | executor-high | verified | verified; questions service; cap race 6 to 5; pin race leaves one pinned; 13 tests |
| 6 | question-upvotes.service | HIGH | executor-high | verified | verified; upvotes service and races; own-question 403; hidden 404; 16 tests with switch tests |
| 7 | setQnaOpen and endSession closes Q&A | HIGH | executor-high | verified | verified; Q&A switch; endSession closes Q&A; close and end races |
| 8 | Realtime senders, combined upvotes, fresh reads, shutdown, stubs | HIGH | executor-high | verified | verified; Q&A realtime senders; combined upvotes; hidden never sent; 8 tests |
| 9 | Controller, routes, settings route, limiters, sends after commit | MEDIUM | executor-medium | verified | verified; Q&A routes, settings route, end emit; 17 route tests |
| 10 | Cross-cutting secrecy and race tests | HIGH | executor-high | verified | verified; Q&A secrecy and race tests; 5-run series clean; timing checks moved to one clock |
| 11 | Web client, reducer, hooks, merge | MEDIUM | executor-medium | verified | verified; web client, reducer, hooks, merge; web 122 tests |
| 12 | Presenter QnaPanel (hidden section, pin, answer, switch) | MEDIUM | executor-medium | verified | verified; presenter Q&A panel; real error codes; not seen in a browser |
| 13 | Participant view (large upvote button, "Your question", paused) | MEDIUM | executor-medium | verified | verified; participant Q&A view; upvote 56px; not seen in a browser |
| 14 | Docs 03, 04, 05, 07 and tracking | LOW | executor-low | verified | verified; docs 02, 03, 04, 05, 07 updated (english) |

## Execution groups
G1 (1, 2) → G2 (3) → G3 (4) → G4 (5, 6, 7) → G5 (8) → G6 (9) → G7 (10) → G8 (11, 12, 13) → G9 (14).

## Approval
- Plan v1 approved by the developer on 2026-10-24. Execution started.

## Approvals needed
- **New packages:** none.
- **Session column:** `sessions.qna_open` (additive ALTER).
- **Destructive down:** `create-questions-and-upvotes` deletes all Q&A data — test database only until approved.

## Decisions (answered 2026-10-24)
- Same question text again is refused (409 QUESTION_ALREADY_ASKED). Q&A open by default. Pin replaces the current pin.
  Answers are one line. Rate limits: 120/min submits, 300/min upvotes, per IP.

## Issues & updates
- **2026-10-24 · MEDIUM · Intermittent word-cloud race test (OPEN):** "ending a session while a submission is in flight counts that word and closes the prompt exactly once" (api/tests/integration/wordcloud-races.test.ts) failed about 1 run in 5 earlier. Observed causes so far: an assertion on closed_at ordering (fixed by locking before the stamp) and a 5 s default timeout (test raised to 30 s). The last failure was a timeout. Test is SKIPPED on the developer instruction (2026-10-24) and must be re-enabled once the cause is confirmed. Note: a full-suite run started while another was still running caused mass failures (both runs share one test database); run the suite one at a time.
- **2026-10-24 · LOW · Clock consistency:** Q&A session stamps (ended_at, qna updated_at) now come from the database clock, like the other features.

- **2026-10-24 · LOW · Moderation reply not typed (web):** the PATCH reply for a question is not validated against its schema; the client returns ok with no data. Works today; should be typed.
- **2026-10-24 · LOW · Realtime burst test timing:** the Q&A burst test relies on three upvotes landing within 150 ms; may be sensitive on a slow machine.
- **2026-10-24 · LOW · Live e2e hidden-text check:** the check for hidden text after hide is written awkwardly and is weaker than the component and race tests.

- **2026-10-24 · HIGH · Plan gap: end-session broke after the new constraint:** the migration added CHECK sessions_qna_closed_when_ended (an ENDED session must have Q&A closed). Until endSession also set qnaOpen to false, 27 integration tests failed. Fixed in endSession; full suite green afterwards.

<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-24 | plan_created | Plan v1 drafted by planner; decisions answered; awaiting plan approval | planning-tracking.md |
| 2026-10-24 | approval | Plan v1 approved; migrations and destructive down on test DB only | planning-tracking.md |
| 2026-10-24 | build | Tasks 1–14 built in groups; each verified with real exit codes | api/, shared/, web/, docs/02-05, 07 |
| 2026-10-24 | verify | Full run: integration 311 pass and 1 skipped (see Issues); live e2e 28/28 | — |
