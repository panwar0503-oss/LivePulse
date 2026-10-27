# 01 — Product Requirements

## 1. Product summary

**Name:** LivePulse (working name)
**Product type:** AI-assisted, real-time audience engagement web app (StreamAlive-inspired, original design)
**Audience for the prototype:** CTOs and engineering leaders evaluating product and engineering depth.
**Primary goal:** A presenter runs a live session; the audience joins from any browser with a room code and takes
part through polls, a word cloud, Q&A, and reactions — all updating live. An **AI co-pilot** helps the presenter:
it generates polls from their own material, moderates and de-duplicates questions, drafts grounded answers,
summarises what the room thinks, and produces a post-session report. The session can also be driven from Claude
Desktop through an MCP server.

Do not copy StreamAlive branding, assets, code, or exact page designs.

## 2. Users and roles

### Presenter (host)
- Creates a session, gets a room code, join link, and a private **presenter key**.
- Runs polls, word-cloud prompts, Q&A, and sees reactions.
- Uploads session material (slides/notes) for the AI knowledge base.
- Reviews AI suggestions: polls, answer drafts, held questions, insights. Nothing AI-made reaches the audience
  without presenter approval.
- Ends the session, reads the AI report, asks questions about the session.

### Participant (audience)
- Joins with room code + display name (no account).
- Votes, submits a word/phrase, asks and upvotes questions, sends reactions.
- Sees results when allowed, approved answers, and clear connection/validation states.

### AI co-pilot (system actor)
- Acts only through the server, with the presenter's session scope, and only drafts or holds — never publishes.

### Evaluator (CTO / reviewer)
- Runs the app locally, follows the demo script, reads architecture and trade-offs, runs tests.

## 3. Scope

### Core engagement (no AI required)
1. Landing page: Create session / Join session.
2. Session creation with title and optional description; unique human-friendly room code; presenter key.
3. Presenter dashboard with session status and live participant count.
4. Participant joining with display name and a server-issued opaque participant token.
5. Multiple-choice polls (2–6 options), lifecycle DRAFT → ACTIVE → CLOSED, one vote per participant per poll.
6. Live vote counts and percentages; presenter controls whether participants see results.
7. Word cloud: one short response per participant per prompt, deterministic normalisation and counts.
8. Q&A: participants ask questions, upvote others' questions (one upvote each), presenter marks answered/hides.
9. Reactions: fixed emoji set, rate-limited, shown as live floating bursts and aggregate counts.
10. Session end → everything read-only; final results page.
11. Refresh/reconnect restores current state from the server.

### AI co-pilot (see `10-ai-architecture.md`)
12. **Knowledge base (RAG):** presenter uploads PDF/Markdown/text; content is chunked, embedded, and stored in
    PostgreSQL (pgvector) for this session only.
13. **AI poll generator:** suggests polls grounded in the uploaded material and current discussion; presenter
    edits and creates.
14. **AI Q&A co-pilot (LangGraph):** moderates incoming questions, merges near-duplicates, drafts answers with
    citations to the material, presenter approves/edits before publishing.
15. **Live insights:** semantic themes over word-cloud responses, room sentiment pulse, on-demand "what is the
    room thinking" summary.
16. **Post-session report + "Ask your session":** narrative report built around real aggregates; presenter chat
    over session data with streamed, cited answers.
17. **MCP server:** presenter tools (snapshot, create/start/close poll, suggest polls, approve answers, insights)
    usable from Claude Desktop / Claude Code.
18. AI controls: global kill switch, per-session toggle, token budget, usage panel, offline `fake` provider.
    Differentiators (docs/10 §5.7): hybrid keyword + semantic search with reranking; live question clusters;
    multilingual questions with translated answers; Pulse Coach suggestions from live signals; approval-gated
    actions for Claude and the in-app assistant; read-only tool-using session chat.

### Platform
19. REST API + Socket.IO; Redis adapter for multi-instance broadcast; PostgreSQL via Sequelize as source of truth.
20. Validation, error states, structured logs, rate limits, automated tests, Docker Compose, README, demo script.
21. Responsive desktop presenter UI and mobile-first participant UI.

## 4. Out of scope unless explicitly requested
- Zoom/Teams/Meet/YouTube integrations, webinar streaming, overlays on video.
- Accounts, SSO, payments, billing, multi-tenant orgs.
- Native mobile apps.
- Voice/transcription of the presenter's talk (possible future AI feature).
- Fine-tuning or training models; a separate vector database service.
- Kubernetes, microservices, production HA, specific scale targets.
- Full StreamAlive parity (maps, spin-the-wheel, quizzes with leaderboards) — candidates for later enhancements.

## 5. Pages and routes

Frontend:
- `/` — landing
- `/host` — create session (shows room code, join link, presenter key once)
- `/join` — enter room code + name
- `/host/[sessionId]` — live control room: polls, word cloud, Q&A, reactions, **AI panel**
- `/host/[sessionId]/knowledge` — upload/manage session material
- `/room/[roomCode]` — participant experience
- `/results/[sessionId]` — final results + AI report + "Ask your session"

Backend:
- `/health` — liveness; `/ready` — PostgreSQL, Redis, and (informational) AI provider status, no secrets.

## 6. Functional requirements

### Session
- Trimmed, length-limited title; optional description.
- Server-generated unique room code with bounded collision retry.
- Presenter key: high-entropy, shown once at creation, stored hashed; required for every presenter action.
- States ACTIVE and ENDED; an ended session rejects all submissions and AI jobs that would publish.
- Public lookup by code exposes only participant-safe fields.

### Participants
- Validate room code and display name; issue opaque token scoped to one session, stored hashed.
- Refresh reuses the stored token; browser-generated IDs are never trusted.
- Connected count is ephemeral presence, not total registrations.

### Polls
- Question required; 2–6 non-empty options; length limits.
- Only the presenter can create/start/close/toggle visibility. Start requires ACTIVE session + DRAFT poll.
- One active poll at a time per session (simplifies participant UI).
- Closed polls are immutable; result visibility enforced on the server.
- Polls created from an AI suggestion record the suggestion they came from.

### Votes
- Participant must belong to the session; poll and session must be ACTIVE; option must belong to the poll.
- One vote per participant per poll via PostgreSQL unique constraint + transaction; retries never inflate counts.
- Emit result updates only after commit; counts come from PostgreSQL.

### Word cloud
- Presenter opens a prompt; one response per participant per prompt.
- Trim, collapse whitespace, lowercase for the aggregation key; keep a display form; max length; rate limit.
- Top-N with deterministic ordering; safe text rendering; helpful empty state.
- The exact-count cloud is deterministic and is **not** AI. AI themes (if enabled) are shown separately and
  labelled.

### Q&A
- Participant submits a question (length-limited, rate-limited). Presenter can turn Q&A on/off.
- One upvote per participant per question (unique constraint); no upvoting your own question.
- Ordering: by upvotes desc, then oldest first. Presenter can mark answered, hide, or pin.
- With AI moderation on, flagged questions are held (`PENDING_REVIEW`) and visible only to the presenter.
- Near-duplicates (AI) are linked to the original; the asker sees a friendly message and their upvote counts.
- Approved AI answers appear under the question labelled "Answer (AI-assisted, approved by presenter)".

### Reactions
- Fixed emoji set (e.g. 👍 ❤️ 😂 😮 👏 🤔). Server rejects anything else.
- Per-participant rate limit (e.g. 5 per 5 seconds). Broadcast as throttled bursts (aggregated every ~500 ms).
- Persisted as per-minute counts for the sentiment timeline and report — not one row per tap.

### AI co-pilot
- Each feature is enabled per session by the presenter; global `AI_ENABLED` can disable all.
- All AI output is a suggestion/draft until the presenter acts. Labelled as AI in the UI.
- Answers and polls are grounded in this session's material; when material doesn't cover it, the AI says so.
- AI failures never block core features; presenter sees a retryable error state.
- Token usage per session is tracked and capped.

### Real-time
- Socket.IO with Redis adapter; every inbound event validated and authorized.
- Rooms: `session:<id>` (everyone) and `presenter:<id>` (presenter only; AI drafts, held questions, usage).
- Acks with structured success/error. Reconnect → revalidate → fetch state over HTTP.

## 7. UX states
Every major screen: loading, empty, success, validation error, server error with retry, connecting /
reconnecting / disconnected, closed / ended, pending (disabled controls). AI panels add: AI disabled, AI working
(progress), AI failed (retry), budget exhausted.

## 8. Accessibility and responsiveness
Semantic HTML, labelled controls, keyboard navigation, visible focus, contrast, state not by colour alone,
textual counts beside charts, `prefers-reduced-motion` respected for reaction animations, mobile-first participant
view.

## 9. Acceptance criteria
1. Presenter creates a session and shares the code; two participant browsers join.
2. Poll created, started, voted, closed; duplicate and concurrent votes produce exactly one vote each.
3. Results, word cloud, questions, upvotes, and reactions update live without refresh.
4. Closed poll and ended session reject submissions.
5. Refresh/reconnect restores state; data survives backend restart.
6. Two backend instances share broadcasts through Redis.
7. Presenter uploads a PDF; AI suggests a poll grounded in it; presenter creates it; audience votes.
8. A participant asks a question covered by the material → presenter gets a cited draft → approves → audience
   sees the answer. A question not covered → draft says it is not in the material.
9. A near-duplicate question is merged; an abusive question is held for review.
10. AI themes and a room summary appear for real responses; report generated after the session ends with
    numbers matching the database.
11. From Claude Desktop (MCP), the presenter creates and starts a poll; audience screens update live.
12. With `AI_ENABLED=false` or the provider down, all core features still work.
13. Critical rules have automated tests (AI tests run on the fake provider, no network).
14. README setup works on a clean checkout; known limitations documented honestly.
