# word-cloud — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Word cloud

### Architecture
```
DB:  word_prompts, word_responses (one additive migration).
     One open prompt per session = partial unique index WHERE status='ACTIVE'.
     One answer per participant per prompt = unique (prompt_id, participant_id).
API: /api/sessions/:id/word-prompts, /api/word-prompts/:id/{start,close,responses}, PATCH /api/word-prompts/:id,
     GET /api/sessions/by-code/:code/word-prompts/current
Realtime: wordcloud:started | closed | updated → session room;
     wordcloud:results → presenter room when hidden, session room when shown. Sent after commit.
Web: presenter page → WordPromptsPanel; ParticipantClient → LiveParticipantWordPrompt.
```

### Key decisions
1. Submissions over HTTP (same reason as votes). The `word:submit` socket command in the old docs is removed.
2. `normaliseWord(raw) → { display, key }` in shared: strip control and zero-width characters, trim, collapse whitespace,
   NFC; `key = display.toLowerCase()` (accents kept). Limits: raw ≤ 200 characters; display 1–30 characters.
   Messages: "Type a word or short phrase." / "Use 30 characters or fewer."
3. Lock order: session row before prompt row (same rule as polls). Submit: prompt `FOR SHARE`. Close and show-cloud
   switch: prompt `FOR UPDATE`. Create: session `FOR SHARE`. End: session `FOR UPDATE`, then close the open prompt
   with `clock_timestamp()`.
   **Start differs from polls (Q2 — confirmed):** start takes the session `FOR UPDATE`, closes the open prompt (its
   update waits for submissions in flight), then sets the target ACTIVE. Opening a new prompt closes the old one.
4. Cloud query in the database: count desc, then `normalized_word COLLATE "C"` asc, `LIMIT 30`. Display word = most
   common `display_word` per key, ties by `display_word COLLATE "C"`. The browser never re-sorts.
5. Version = total responses (answers are final). Broadcasts combined per prompt (~250 ms); visibility and counts read
   fresh at send time.
6. Per-recipient rule: one mapper `toParticipantPrompt` sets `cloud: null` when `showCloud` is false, and refuses drafts.
7. Closing a closed prompt returns 200 unchanged. The show-cloud switch is allowed on closed prompts.
8. No separate GET cloud endpoint; the cloud is inside the presenter list and the participant current-prompt response.
9. Cloud drawn as a Tailwind flex-wrap list in rank order with a few font-size steps; no layout library.
10. Draft step kept (Q3 — confirmed): create, then open.
11. Rate limit: 300 per minute per IP for submissions (Q1 — confirmed). Create: 60 per minute per IP.
12. Submission retry returns 409 `WORD_ALREADY_SUBMITTED` (Q5 — recommended, accepted).

### Contracts: HTTP (POSTs and PATCH pass the origin check)
| Method / path | Who | Body → success | Errors |
|---|---|---|---|
| POST /sessions/:id/word-prompts | Presenter | `{ question, showCloud? = true }` → 201 PresenterPrompt (DRAFT) | 400, 401, 404, 409 SESSION_ENDED, 409 PROMPT_LIMIT_REACHED (50), 429 |
| GET /sessions/:id/word-prompts | Presenter | → 200 `{ prompts }` with clouds | 401, 404 |
| POST /word-prompts/:id/start | Presenter of the prompt's session | → 200 PresenterPrompt (closes the open one) | 401, 404, 409 SESSION_ENDED, 409 PROMPT_NOT_DRAFT |
| POST /word-prompts/:id/close | Presenter | → 200 PresenterPrompt (unchanged if already closed) | 401, 404, 409 PROMPT_NOT_ACTIVE |
| PATCH /word-prompts/:id | Presenter | `{ showCloud }` → 200 PresenterPrompt | 400, 401, 404 |
| POST /word-prompts/:id/responses | Participant of the prompt's session (checked before body) | `{ text }` → 201 `{ promptId, myWord }` (no counts) | 400, 401 PARTICIPANT_AUTH_REQUIRED, 404, 409 PROMPT_NOT_ACTIVE, 409 WORD_ALREADY_SUBMITTED, 429 (300/min/IP) |
| GET /sessions/by-code/:code/word-prompts/current | Participant | → 200 `{ prompt }` (open, else last closed) | 401, 404 |

DTOs: `WordCloud = { total, version, entries: [{ key, word, count }] }`;
`PresenterPrompt = { id, question, status, showCloud, closedAt, cloud }`;
`ParticipantPrompt = { id, question, status, showCloud, closedAt, myWord, cloud | null }`.

### Contracts: socket events (server → client)
| Event | Room | Payload |
|---|---|---|
| wordcloud:started | session | `{ prompt: { id, question, showCloud } }` |
| wordcloud:closed | session | `{ promptId, closedAt }` (also when start or end closes a prompt) |
| wordcloud:updated | session | `{ promptId, showCloud }` (clients refetch) |
| wordcloud:results | presenter room if hidden, session room if shown | `{ promptId, total, version, entries }` |

### Files
| File | C/M | Purpose | Risk |
|---|---|---|---|
| shared/src/schemas/word-cloud.ts (+ test), shared/src/index.ts | C/M | normaliseWord, Zod bodies, DTOs | MEDIUM |
| shared/src/events/realtime.ts (+ test) | M | four events | MEDIUM |
| api/migrations/<generated>-create-word-prompts-and-responses.cjs | C | tables, enum, constraints; destructive down | HIGH |
| api/src/models/{word-prompt,word-response}.model.ts, models/index.ts | C/M | models, associations | MEDIUM |
| api/src/services/word-prompts.service.ts, word-responses.service.ts | C | rules, locks, cloud SQL, mappers | HIGH |
| api/src/services/sessions.service.ts, controllers/sessions.controller.ts | M | end closes the open prompt; returns closedPrompt | HIGH |
| api/src/realtime/word-cloud.ts, realtime/index.ts, server.ts, shutdown.ts | C/M | senders, combined updates, timer cleanup | HIGH |
| api/src/controllers/word-prompts.controller.ts, routes/word-prompts.routes.ts, app.ts | C/M | wiring, rate limits, sends after commit | MEDIUM |
| api/tests/helpers/{test-app,realtime-harness,truncate}.ts | M | stubs, new tables | LOW |
| api/tests/integration/word-*.test.ts, api/tests/realtime/wordcloud-*.test.ts | C | behaviour, races, secrecy | HIGH |
| web/src/lib/api/word-prompts.ts, web/src/realtime/{session-socket-state,use-session-socket}.ts | C/M | client, events | MEDIUM |
| web/src/hooks/{use-presenter-word-prompts,use-participant-word-prompt,word-cloud-merge}.ts | C | snapshot plus live merge by version | MEDIUM |
| web/src/components/word-cloud/*.tsx (+ tests); presenter page; ParticipantClient | C/M | UI | MEDIUM |
| docs/02, 03, 04, 05, 07 | M | contracts, lock order | LOW |

### Impact analysis
- **Breaking:** `endSession` returns `{ session, closedPoll, closedPrompt }`; `Realtime` gains word-cloud senders; test
  fakes change; `initModels` gains two models. Events are additive. Docs updated (03, 04, 05, 02).
- **Migration / rollback:** additive; the down **deletes all word-cloud data** — test database only until approved.
- **Concurrency:** duplicate submissions → unique key wins (error caught outside the transaction callback). Close vs
  submit → whichever takes the row lock first wins. Two starts → queued by the session lock; exactly one ACTIVE.
  End vs submit → end waits for in-flight submissions; `closed_at` set after the wait.
- **Security:** hidden clouds never leave the server (one mapper; room chosen from a fresh read). Submit response has no
  counts. Plain text: React text nodes only, no `dangerouslySetInnerHTML`. Normalisation cannot bypass the one-answer rule
  (the key is the participant). Length limits in Zod and the database. Residual few-millisecond window on hide (accepted,
  with a test, as in polls).
- **Testing (real Postgres):** normalisation cases (case, spaces, tabs, NBSP, accents kept, Turkish İ, zero-width-only is
  empty, `<b>` literal, 30 vs 31 characters, emoji length, NFC joins); concurrency (duplicates, two tabs, close vs submit
  both orders, end vs submit, two starts); secrecy (hidden: no words or counts to participants; `cloud: null`); ordering
  (35 keys with ties → exactly 30, fixed order); empty cloud.

### Edge cases
Double tap or two tabs → one answer, 409, client shows `myWord` · submit after close → 409 · start while another is
open → old one closes, room sees `wordcloud:closed` then `wordcloud:started` · create or start after end → 409 · reload →
`myWord`, box disabled · late joiner → current prompt · hide while answers arrive → nothing new to participants ·
reveal after close → `wordcloud:updated` then results · a poll and a prompt open together → independent panels ·
invisible-only answer → 400.

## Tasks (v1)
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|
| 1 | Shared `normaliseWord`, Zod bodies, DTOs | MEDIUM | executor-medium | verified | verified; normaliseWord, Zod bodies and DTOs; 18 tests |
| 2 | Shared wordcloud event schemas and map | LOW | executor-low | verified | verified; word event schemas |
| 3 | Generated migration with constraints, partial index, destructive down | HIGH | executor-high | verified | verified; up/down/up on test DB; constraint probes raised expected errors |
| 4 | Models, associations, `Models` type, truncate helper | MEDIUM | executor-medium | verified | verified; 5 word model tests |
| 5 | word-prompts.service: create, list, current, start (closes previous), close, switch, cloud SQL, mappers | HIGH | executor-high | verified | verified; word-prompts service; 13 tests; top-30 ordering |
| 6 | word-responses.service `submitWord` | HIGH | executor-high | verified | verified; submitWord; 7 service tests; 6 race tests |
| 7 | `endSession` closes the open prompt | HIGH | executor-high | verified | verified; endSession closes open prompt; 5 end tests |
| 8 | Realtime senders, combined updates, shutdown, test stubs | HIGH | executor-high | verified | verified; word-cloud realtime senders; 7 realtime tests |
| 9 | Controller, routes, rate limits, sends after commit | MEDIUM | executor-medium | verified | verified; 14 route tests; word field mapping; emits after commit |
| 10 | Cross-cutting secrecy and race tests | HIGH | executor-high | verified | verified; 5 secrecy and 4 race tests; race file clean |
| 11 | Web client, socket reducer, hooks, version merge | MEDIUM | executor-medium | verified | verified; web client, reducer, hooks, merge; web 98 tests |
| 12 | Presenter panel, create form, WordCloud (empty message, aria-live polite, text only) | MEDIUM | executor-medium | verified | verified; WordCloud (plain text, server order), panel, presenter wiring; not seen in a browser |
| 13 | Participant view (large input, "Your word is in.", closed and hidden states) | MEDIUM | executor-medium | verified | verified; participant word view and live glue; not seen in a browser |
| 14 | Docs 02, 03, 04, 05, 07 and tracking | LOW | executor-low | verified | verified; docs 02, 03, 04, 05, 07 updated (english) |

## Execution groups
G1 (1, 2) → G2 (3) → G3 (4) → G4 (5, 6, 7) → G5 (8) → G6 (9) → G7 (10) → G8 (11, 12, 13) → G9 (14).

## Approval
- Plan v1 approved by the developer on 2026-10-24. Execution started.

## Approvals needed
- **New packages:** none.
- **Destructive down migration:** test database only until approved.

## Decisions (answered 2026-10-24)
- Rate limit 300/min/IP for submissions. Start closes the previous prompt. Draft step kept. Normalisation includes
  invisible-character removal and NFC. Retry returns 409 `WORD_ALREADY_SUBMITTED`.

## Issues & updates
- **2026-10-24 · MEDIUM · Invented presenter error codes:** the presenter message map used codes the API never sends (WORD_PROMPT_*). Fixed to the real codes: PROMPT_LIMIT_REACHED, PROMPT_NOT_DRAFT, SESSION_ENDED.
- **2026-10-24 · LOW · Word submission validation field:** the body schema reports `text.display`; mapped to field `text` in the route. Covered by a test.
- **2026-10-24 · LOW · Live markup check is weak:** the end-to-end check accepts 201 or 409 for markup, so it does not prove plain-text rendering. Plain-text rendering is covered by component tests.
- **2026-10-24 · NOT VERIFIED:** the word-cloud UI in a real browser (components built and tested, no browser run).
- **2026-10-24 · LOW:** the 50-prompt cap and the 300/min submission limit are defaults (the latter chosen by the developer).

<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-24 | plan_created | Plan v1 drafted by planner; decisions answered; awaiting plan approval | planning-tracking.md |
| 2026-10-24 | approval | Plan v1 approved; destructive down migration only on test DB | planning-tracking.md |
| 2026-10-24 | build | Tasks 1–14 built in groups; each verified with real exit codes | api/, shared/, web/, docs/02-05, 07 |
| 2026-10-24 | verify | Full run: lint 0, typecheck 0, unit 80+52+110, prettier 0, integration 238/238; web build 0; live e2e 22/22 | — |
