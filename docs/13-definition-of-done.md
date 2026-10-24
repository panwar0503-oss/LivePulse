# 13 — Definition of Done and Release Checklist

## Product — core
- [ ] Presenter creates a session; room code + presenter key work.
- [ ] Participants join from separate browsers; refresh keeps identity.
- [ ] Polls: 2–6 options, validated lifecycle, one vote per participant, live results, server-side visibility.
- [ ] Word cloud: one response per participant per prompt, exact live counts.
- [ ] Q&A: ask, upvote once, ordering, presenter pin/hide/answer.
- [ ] Reactions: fixed set, rate limit, live bursts, per-minute counts.
- [ ] Ended session rejects submissions; final results page works.

## Product — AI
- [ ] AI toggle per session, global kill switch, budget, usage panel.
- [ ] Knowledge upload → READY → retrieval with citations; session-isolated.
- [ ] Poll suggestions grounded and editable; nothing reaches audience without presenter action.
- [ ] Q&A co-pilot: hold, merge, cited draft, "not covered" path, approve/edit/reject.
- [ ] Live insights: themes, mood, room summary; labelled AI.
- [ ] Session report numbers match the DB; "Ask your session" streams with citations.
- [ ] MCP server tools work from Claude Desktop, scoped to the presenter's session.
- [ ] Core features work with AI disabled or the provider down.

## Data and Sequelize
- [ ] Migrations run `up`/`down` on a clean DB (including pgvector extension and HNSW indexes).
- [ ] Unique constraints: room code, keys/tokens, votes, upvotes, word responses; composite option→poll FK.
- [ ] Vote/close race tested; concurrent upvotes tested.
- [ ] No `sync` outside tests; DTOs hide hashes and embeddings.
- [ ] Data survives restart; pending AI jobs resume.

## Real-time
- [ ] Redis adapter attached before traffic; pub/sub clients connect; graceful shutdown.
- [ ] Session and presenter rooms server-assigned; participants never get presenter/AI events.
- [ ] Commit before emit; reconnect fetches state; two-instance test passes.

## Security and UX
- [ ] Zod on all HTTP and socket inputs; rate limits and size limits (incl. uploads).
- [ ] CORS allowlist, Helmet, no secrets committed or logged, API key never in `web/`.
- [ ] Prompt-injection fixtures pass; AI outputs schema-validated and rendered as text.
- [ ] Loading/empty/error/reconnect/AI-pending/AI-failed states; keyboard + mobile usable; reduced motion.
- [ ] No dead buttons or fake live data.

## Quality and delivery
- [ ] All automated tests pass (AI on fake provider); results reported honestly.
- [ ] Opt-in real-model smoke test run (or explicitly listed as not run).
- [ ] README setup works from a clean clone; `.env.example` placeholders only.
- [ ] API, event, and AI docs match the code.
- [ ] Demo rehearsed (online and offline mode); limitations listed.
