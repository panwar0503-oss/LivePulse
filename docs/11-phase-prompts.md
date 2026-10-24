# 11 — Copy-Ready Phase Prompts

How to use:
1. Copy the **`/requirement`** line of the next phase and paste it into Claude Code. Answer the clarifying
   questions, confirm the requirement.
2. Run **`/execute <name>`**. Review the plan (tasks, risks, new dependencies), approve, let it build.
3. Check the **Verify** list yourself (and the demo moment in the browser), then commit.
4. Only then move to the next phase.

Each `/requirement` line is one line on purpose (the whole text becomes the raw request). The docs it points to
hold the details, so Claude reads them instead of guessing.

---

## Phase 2 — foundation

```
/requirement foundation Set up the LivePulse project skeleton so later features can be built and tested: npm workspaces (api, web, shared) with TypeScript, Prettier/ESLint, Docker Compose for PostgreSQL with the pgvector extension and Redis (with health checks and a persistent volume), env validation with Zod and an .env.example with placeholders only, Express app with structured logging, request IDs, consistent error envelope, Helmet and CORS allowlist, Sequelize connection plus a migration runner (no sync), GET /health and GET /ready (PostgreSQL + Redis status, no secrets), a Next.js App Router + Tailwind shell with a landing page placeholder, and Vitest + Supertest wired with one passing test per workspace. No product features yet. Follow docs/02-architecture.md section 2 and docs/09-local-development.md.
```
```
/execute foundation
```
**Verify:** `docker compose up -d` healthy · `npm install` · migrate runs on empty DB · `/health` 200, `/ready` 200
and 503 when Redis is stopped · web shell loads on :3000 · tests pass · README run steps updated.

---

## Phase 3 — sessions-and-join

```
/requirement sessions-and-join A presenter creates a live session with a title and optional description and receives a short unique room code, a join link and a private presenter key shown only once. A participant opens the join page, enters the room code and a display name, and receives a private participant token for that session only; refreshing the page keeps them in the session. Presenter-only pages and actions require the presenter key. Ended sessions cannot be joined. Room code is discovery, not authorization. Include landing, create and join pages with all loading/error/empty states. See docs/01-product-requirements.md sections 2, 5, 6 (Session, Participants), docs/03 (sessions, participants), docs/04 (Sessions & participants), docs/06.
```
```
/execute sessions-and-join
```
**Verify:** create → code + key shown · two browsers join · wrong code/name errors · presenter endpoint rejects
missing/wrong key · tokens hashed in DB · tests pass.
**Demo moment:** create a session on laptop, join from phone with the code.

---

## Phase 4 — realtime-backbone

```
/requirement realtime-backbone Everyone in a session stays in sync live. Presenter and participants connect over Socket.IO authenticated by their key or token; the server puts them into the session room (and presenters also into a presenter-only room). The presenter sees the live connected-participant count. When anyone reconnects or refreshes they get the current session state from the server. When the presenter ends the session, every screen switches to an ended state immediately. Live updates must work across two backend instances through the Redis adapter, and a missed event must never cause wrong data because clients re-fetch state. See docs/02 sections 4-7, docs/05 sections 1, 2, 4 (presence, session:ended, session:error), docs/04 GET /sessions/:id/state.
```
```
/execute realtime-backbone
```
**Verify:** count updates as tabs open/close · end session flips all screens · reconnect restores state · invalid
token cannot join · two-instance Redis test passes.
**Demo moment:** open 3 phones, watch the count; end session, all phones update.

---

## Phase 5 — live-polls

```
/requirement live-polls The presenter creates multiple-choice polls (2-6 options), starts one at a time, and closes it. Participants vote once per poll and see results live if the presenter allows it; the presenter always sees live counts and percentages. Duplicate or simultaneous votes from the same participant must count once, votes after closing are rejected, and a vote and a close happening at the same moment must have one clear outcome. Closed polls are read-only. See docs/01 (Polls, Votes), docs/02 section 4 Vote, docs/03 (polls, poll_options, votes), docs/04 Polls & votes, docs/05 poll events, docs/07 Polls & votes.
```
```
/execute live-polls
```
**Verify:** concurrency test (parallel duplicate votes → 1 row) · close/vote race test · visibility hidden from
participants when off · results live on 2 browsers.
**Demo moment:** run a poll, phones vote, bars move live; try to vote twice.

---

## Phase 6 — word-cloud

```
/requirement word-cloud The presenter opens a word-cloud prompt; each participant submits one short word or phrase; everyone sees a live word cloud where identical answers (ignoring case and extra spaces) grow bigger. Text is always shown safely, empty clouds show a friendly state, and the counting is exact and deterministic (this feature is not AI). The presenter can close the prompt. See docs/01 (Word cloud), docs/03 (word_prompts, word_responses), docs/04 Word cloud, docs/05 wordcloud:updated, docs/07 Word cloud.
```
```
/execute word-cloud
```
**Verify:** normalisation tests · one response per participant · `<script>` text renders as text · live updates.
**Demo moment:** "One word for how you feel about AI at work?" — cloud grows live.

---

## Phase 7 — live-qna

```
/requirement live-qna Participants ask questions and upvote other people's questions (one upvote each, not their own). Everyone sees the question list live, sorted by upvotes then age. The presenter can open/close Q&A, pin, hide, mark answered and type a short answer that appears under the question. Hidden or rejected questions are never shown to participants. Rate limits stop spam. See docs/01 (Q&A), docs/03 (questions, question_upvotes), docs/04 Q&A, docs/05 question events, docs/07 Q&A.
```
```
/execute live-qna
```
**Verify:** concurrent upvotes count once · ordering · participants never see hidden · presenter actions
authorized · live on 2 browsers.
**Demo moment:** audience asks and upvotes; top question rises live.

---

## Phase 8 — live-reactions

```
/requirement live-reactions Participants tap emoji reactions (fixed set: thumbs up, heart, laugh, wow, clap, thinking). The presenter screen and participant screens show live floating reactions and running totals without slowing the app down when many people tap at once. Each participant is rate-limited. Reaction counts are kept per minute so they can be shown as a timeline later. Respect reduced-motion settings. See docs/01 (Reactions), docs/03 (reaction_counts), docs/05 sections 4 and 6, docs/07 Reactions.
```
```
/execute live-reactions
```
**Verify:** unknown emoji rejected · rate limit · N taps → bursts, flushed counts match · reduced motion.
**Demo moment:** everyone taps 👏 — burst animation on the presenter screen.

---

## Phase 9 — ai-foundation

```
/requirement ai-foundation Add the AI foundation that later AI features use, with no audience-facing feature yet. The presenter can turn AI on or off per session and sees an AI status and usage panel (tokens used vs budget, jobs running/failed). AI work runs in the background after data is saved, survives a server restart, retries a limited number of times, and never blocks or breaks polls, word cloud, Q&A or reactions. There is a global AI kill switch, a per-session token budget, a real provider (Anthropic Claude through LangChain) and a fake offline provider used by tests and offline demos, local embeddings, and PostgreSQL pgvector ready for vector search. See docs/10-ai-architecture.md sections 1-4, 6-7, docs/03 (pgvector setup, ai_jobs), docs/04 AI usage and jobs, docs/05 ai:job-failed and ai:usage, docs/06 section 3, docs/07 AI foundation.
```
```
/execute ai-foundation
```
**Verify:** fake provider tests pass with no network · one real smoke call when `AI_PROVIDER=anthropic` (needs
key; confirm no sampling params / forced tool choice errors) · concurrent job claim test · `AI_ENABLED=false`
leaves core flows working · vector extension migration up/down.
**Open decisions to settle in the plan:** fast model (`AI_FAST_MODEL`), pgvector Sequelize approach, embeddings
library + model.

---

## Phase 10 — knowledge-base-rag

```
/requirement knowledge-base-rag The presenter uploads their session material (PDF, Markdown or text, with size and page limits) on a knowledge page and sees each document's processing status. The material is split into chunks, embedded and stored for this session only. The presenter can try a search box that shows the most relevant passages with page numbers and scores, and can delete documents. Material from one session must never be used for another session. If nothing relevant is found, the system says so instead of guessing. See docs/10 sections 5.1, 5.7A and 8, docs/03 (knowledge_documents, knowledge_chunks, vector query shape), docs/04 AI knowledge base, docs/05 ai:knowledge-updated, docs/06 AI controls 6 and 8, docs/07 Knowledge base.
```
```
/execute knowledge-base-rag
```
**Verify:** upload PDF → READY with chunks · search returns relevant pages · cross-session leakage test ·
415/413 cases · delete removes chunks.
**Demo moment:** upload your pitch deck; search "pricing" → shows slide 7 passage.

---

## Phase 11 — ai-poll-generator

```
/requirement ai-poll-generator The presenter clicks "Suggest polls", optionally types an instruction like "check understanding of the pricing model", and within seconds gets 1-3 poll suggestions based on their uploaded material and current Q&A topics, each with a short reason and the source passages. The presenter can edit a suggestion and create it as a normal poll, or dismiss it. Suggestions are clearly labelled as AI and never appear to the audience until the presenter creates and starts the poll. See docs/10 section 5.2, docs/03 (ai_poll_suggestions, polls.source_suggestion_id), docs/04 AI features, docs/05 ai:poll-suggestions-ready, docs/07 AI poll generator.
```
```
/execute ai-poll-generator
```
**Verify:** schema-validated suggestions (fake provider) · cited chunk IDs exist · accept → DRAFT poll linked ·
real-model manual check on a sample deck.
**Demo moment:** "Suggest polls" → pick one → start → audience votes.

---

## Phase 12 — ai-qna-copilot

```
/requirement ai-qna-copilot When AI is on, every new audience question is checked by an AI co-pilot. Abusive, spam or off-topic questions are held for the presenter to release or reject. A question that means the same as an earlier one is merged into it (the asker's upvote goes to the original and they are told). For other questions the co-pilot drafts an answer using only the presenter's material, with citations; if the material does not cover it, the draft says so. The presenter sees drafts in the AI panel and can approve, edit then approve, or reject; approved answers appear under the question for everyone, labelled AI-assisted. Drafts and held questions are never shown to participants, and pending approvals survive a server restart. Similar questions are grouped into labelled clusters the presenter can answer at once, and questions asked in other languages are translated for the presenter while answers return in the asker's language. Built as a LangGraph workflow. See docs/10 sections 5.3, 5.7B, 5.7D and 8, docs/03 (questions AI columns, ai_answer_drafts), docs/04 AI features, docs/05 ai:answer-draft-ready / ai:question-flagged / ai:question-merged, docs/06 section 3, docs/07 AI Q&A co-pilot.
```
```
/execute ai-qna-copilot
```
**Verify:** graph routing tests for each branch · prompt-injection fixture causes no state change · duplicate
merge doesn't double count · approval after restart · participants never receive drafts.
**Demo moment:** ask "What does the enterprise plan cost?" → cited draft → approve → phones show answer.
Ask "how much is enterprise pricing?" → merged.

---

## Phase 13 — ai-live-insights

```
/requirement ai-live-insights The presenter sees live AI insights in the AI panel: themes that group similar word-cloud answers (for example "teamwork" and "collaboration") with counts, a room mood indicator based on recent questions, answers and reactions with a short reason, and a "What is the room thinking?" button that gives 3-5 bullet points with evidence counts. A Pulse Coach panel suggests the next move (for example a recap or a follow-up poll) when signals such as confusion reactions or a fast-growing question cluster appear; suggestions are dismissable and never act by themselves. The exact word cloud stays unchanged; insights are labelled AI and refresh at most every few seconds and only when there is new input. See docs/10 sections 5.4 and 5.7C, docs/03 (word_responses.embedding, ai_insights), docs/04 AI features insights, docs/05 ai:insights-updated, docs/07 Live insights.
```
```
/execute ai-live-insights
```
**Verify:** synonym fixture grouped · debounce · validated payloads · exact cloud unchanged.
**Demo moment:** 10 phones answer → themes appear; click "What is the room thinking?".

---

## Phase 14 — ai-session-report

```
/requirement ai-session-report When the presenter ends a session, an AI report is prepared automatically: key takeaways, poll outcomes, top answered and unanswered questions, word themes, a mood/reaction timeline and suggested follow-ups. All numbers must match the real session data. On the results page the presenter can also chat with "Ask your session" (for example "What confused people most?") and get answers streamed live with citations to questions, responses and material from this session only. The chat uses read-only tools bound to this session (poll results, questions, word themes, materials). See docs/10 sections 5.5 and 5.7F, docs/03 ai_insights SESSION_REPORT, docs/04 report and ask endpoints, docs/05 ai:report-ready, docs/07 Session report & ask-session.
```
```
/execute ai-session-report
```
**Verify:** report numbers equal SQL aggregates · generated once · streaming works and ends with citations ·
session-scoped.
**Demo moment:** end session → report appears → ask "what should I follow up on?".

---

## Phase 15 — mcp-server

```
/requirement mcp-server A presenter can run their live session from Claude Desktop or Claude Code through a LivePulse MCP server: get a live snapshot, create/start/close polls, get AI poll suggestions, list questions and approve answer drafts, and read insights and the report. The MCP server runs locally, is configured with the presenter key for their session, can only act on that session, and follows exactly the same rules as the web app so the audience sees changes live. Changes Claude makes are proposed, and the presenter approves them in the web app before they run. Include setup instructions for Claude Desktop. See docs/10 sections 5.6 and 5.7E, docs/06 AI control 11, docs/07 MCP server.
```
```
/execute mcp-server
```
**Verify:** tool list matches doc · wrong key/other session rejected · create+start poll via MCP → phones
update · setup doc works from a clean Claude Desktop config.
**Demo moment:** in Claude Desktop: "Look at my LivePulse session and start a poll about what confused people."

---

## Phase 16 — hardening (no new requirement)

Run in order, fixing findings with `/bug-fix`:
```
/code-review
```
```
Use the security-reviewer agent to review auth, socket rooms, AI prompt-injection defences, retrieval session isolation, uploads, secrets and MCP scope against docs/06-security-privacy.md. Report findings only.
```
```
/run-tests
```
**Verify:** no critical findings open · all tests green · manual E2E in `07` §3 done.

---

## Phase 17 — demo-readiness

```
/requirement demo-readiness Make the prototype easy to demo to CTOs: a one-command local start, an optional clearly-labelled demo seed (sample session, sample deck, sample questions) that never fakes live counts, an offline demo mode using the fake AI provider, a script to start two backend instances for the scaling demo, a polished README with architecture diagram, setup, AI configuration and known limitations, and a rehearsal checklist following docs/12-demo-and-interview.md. See docs/09, docs/12, docs/13.
```
```
/execute demo-readiness
```
**Verify:** clean clone → README steps → full demo works · offline mode works with Wi-Fi off · `13` checklist
ticked.
