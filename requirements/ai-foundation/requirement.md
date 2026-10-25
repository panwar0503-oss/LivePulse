# Feature: AI foundation

## Metadata
- **Name**: ai-foundation
- **Status**: in_progress
- **Current phase**: initial
- **Created**: 2026-10-24 · **Last updated**: 2026-10-24
- **Parent** (enhancements only): n/a

## Original request
Phase 9 of the LivePulse roadmap (`docs/08-implementation-plan.md`): add the AI foundation that later AI features use,
with no audience-facing AI feature yet. The presenter can turn AI on or off per session and sees an AI status and usage
panel. AI work runs in the background after data is saved, survives a server restart, retries a limited number of times,
and never blocks or breaks polls, word cloud, Q&A or reactions. There is a global AI kill switch, a per-session token
budget, a real provider (Claude), and a fake offline provider used by tests and offline demos, local embeddings, and
PostgreSQL pgvector ready for vector search.

## What it does
The presenter switches AI on for a session and can see how much of the session's AI budget has been used and whether any
AI work has failed. In the background, the system can run AI tasks (such as drafting an answer or summarising
questions) and store the results. Nothing AI-made reaches the audience in this phase. Every AI task has a limited number
of retries, a visible failure state, and a budget check before it runs. If Claude is unavailable, the rest of the app
keeps working exactly as before.

## Who uses it
- **Presenter** — turns AI on or off for a session, sees AI usage and failures.
- **Operator (developer)** — sets the global kill switch, the budget default, and the provider settings; checks the
  health of AI work.
- **Future features** — will create AI tasks through this foundation; they are not built in this phase.

## User stories
1. As a presenter, I want to turn AI on for my session so that AI features are used only when I choose.
2. As a presenter, I want to see how much AI budget is used so that I know when AI will pause.
3. As a presenter, I want to be told when an AI task failed so that I can retry or continue without it.
4. As an operator, I want one switch that disables all AI so that I can stop AI spend immediately.
5. As an operator, I want AI tests to run without network or cost so that the test suite is fast and free.
6. As a developer, I want AI work to survive a restart so that a task is not lost when the server restarts.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | AI is off for every new session until the presenter turns it on | Turning it on or off is recorded with the session |
| 2 | With AI off, no audience text is sent to any AI provider | Enforced on the server, not only in the page |
| 3 | A global switch disables all AI for every session | When off, AI requests are refused with a clear "AI is turned off" message; core features unaffected |
| 4 | Each session has a token budget (default 200,000 tokens) | Checked before each AI task starts; when used up, new AI tasks are skipped with a clear message |
| 5 | The presenter sees AI usage (tokens used of budget) and recent AI task failures | Plain text, never prompts or raw responses |
| 6 | AI tasks run in the background after the data they depend on is saved | An AI task never runs inside a request or a database transaction |
| 7 | An AI task that fails is retried a limited number of times, then marked failed with a safe reason | No stack traces or provider details shown to the presenter |
| 8 | AI tasks in progress or waiting are picked up again after a server restart | Nothing is lost on restart; duplicate work is avoided |
| 9 | Tests and the offline demo use a fake provider with no network and no cost | Selected by configuration; the real provider is used only when configured |
| 10 | If Claude is unavailable, core features keep working and AI tasks show a retryable state | Polls, word cloud and Q&A are unaffected |
| 11 | Vector storage (pgvector) is ready for later search features | Extension enabled, vector column type available, one-dimension embedding helper checked by tests |
| 12 | A local embeddings model produces vectors on this machine | The model is downloaded once; embedding works offline after that |

## User flows
### Flow 1: Presenter turns AI on and checks usage
1. Presenter opens the AI panel on the dashboard.
2. Presenter switches AI on for this session; the panel shows "AI is on. Audience text may be processed by an AI provider."
3. The usage line shows tokens used of the session budget. It updates after each AI task finishes.
4. Presenter switches AI off; further AI tasks are refused, and the panel shows "AI is off for this session."

### Flow 2: An AI task fails and is retried
1. A background AI task fails because Claude is temporarily unavailable.
2. The task is retried after a short wait, up to the retry limit.
3. If it still fails, the panel shows "An AI task failed. Try again later." with the task name and the time.

### Flow 3: Offline demo
1. The operator starts the app with the fake provider.
2. AI tasks complete with fixed, labelled output, and no network is used.

### Edge cases
- Server restart while a task is running → the task is picked up again once and does not run twice.
- Budget reached mid-task → the task finishes its current step only if the budget allows; otherwise it is skipped with a clear reason.
- AI switched off while a task is queued → the queued task is cancelled and marked skipped.
- Session ended → queued AI tasks for that session are cancelled.
- The same request sent twice → one AI task, not two.

## Real-time behaviour
- Live to the presenter only: AI status changes, usage updates, task failures. Never to participants.
- On reconnect or reload, the panel loads the current AI status and usage from the server.

## Scope
**In scope**
- Per-session AI on/off, global kill switch, per-session token budget with usage display.
- Background task runner with a database-backed queue, limited retries, restart recovery, and cancellation.
- Claude provider (required, configured by API key) and a fake provider (for tests and offline demos).
- Local embeddings model on the server, behind an interface, with a fake implementation for tests.
- pgvector extension enabled and a vector column helper ready.
- Presenter panel for AI status, usage and failures.

**Out of scope**
- Any audience-facing AI feature (moderation, answer drafting, polls from documents, insights, report, MCP).
- Knowledge-base uploads and retrieval (next phase).
- LangGraph workflows (a later phase; this phase uses the task runner).
- Fine-tuning or training models.
- Paid services beyond the Claude API key the developer provides.

## Assumptions
1. Claude is the real provider and needs an API key set in the environment by the developer. Developer chose this (required now).
2. The embeddings model runs locally and is downloaded once. Developer chose this (local model now). Adds packages; approval needed.
3. Default budget 200,000 tokens per session. Developer chose this.
4. AI is off by default for each session. Developer chose this.
5. Retries: up to 3 attempts with a short back-off. Reason: a common default for transient provider errors. Proposed; confirm.
6. The task queue lives in PostgreSQL (no separate queue service). Reason: keeps the source of truth in one place and avoids a new service. Proposed; confirm.

## Risks
- **HIGH**: Audience text sent to a paid provider without the presenter's choice. Impact: privacy breach and cost. Mitigation: AI off by default; server checks the session switch and the global switch before any provider call; tests prove no call happens when off.
- **HIGH**: Runaway spend from repeated or looping AI calls. Impact: unexpected cost. Mitigation: per-session budget checked before each call; retry limit; global kill switch.
- **MEDIUM**: A slow or failing provider blocks live features. Impact: laggy polls or Q&A. Mitigation: AI runs in the background only, never inside a request or transaction.
- **MEDIUM**: The local embeddings model download is large and slow on first run. Impact: a slow first start. Mitigation: download once, show a clear status while loading, and tests use the fake.
- **LOW**: Provider output that is not valid for the expected schema. Impact: a failed task. Mitigation: validated output, safe failure.

## Non-functional requirements (user-facing)
- Turning AI on or off takes effect within 2 seconds for every connected presenter screen.
- A failed AI task is shown to the presenter within 5 seconds of the failure.
- Nothing about AI slows the audience's polls, word cloud or Q&A.

## Success criteria
1. A new session has AI off; the presenter turns it on and off, and the state persists after a reload.
2. With AI off, an AI request is refused and no provider call is made (checked with the fake provider's call counter).
3. With the global switch off, every session's AI requests are refused with a clear message.
4. The session budget is checked before each task; a task that would exceed the budget is skipped with a clear reason.
5. The presenter sees tokens used of budget, updated after tasks finish.
6. A failing task is retried up to the limit and then marked failed with a safe message; no provider detail is shown.
7. After a restart, a waiting task runs once; a running task is picked up again once and does not run twice.
8. The test suite runs AI tests with the fake provider and makes no network call.
9. The Claude provider runs one real request when configured with a key (a manual, opt-in check).
10. The local embeddings model produces a vector of the configured length offline after its first download.
11. pgvector is enabled in the test and dev databases; a vector column can be created and queried for nearest rows.
12. Polls, word cloud and Q&A keep working when AI is off, unavailable or over budget.
13. AI status, usage and failures are visible to the presenter only.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-24 | Created and confirmed (Claude required now; local embeddings now; 200,000 token budget; AI off by default) |
| 2026-10-25 | Build complete for tasks 1–17; status stays in_progress until the fake-mode diagnostic decision is made and the opt-in live checks (Claude call, embeddings model) are run |
