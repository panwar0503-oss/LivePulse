# Stages — index (सूची)

यह folder LivePulse के हर **stage** (चरण) की कहानी हिंदी में रखता है। एक stage = एक requirement folder
(`requirements/<name>/`) = roadmap का एक phase (`docs/08-implementation-plan.md`)।

> Numbering का नियम: roadmap में Phase 1 सिर्फ़ Claude Code workflow और docs था (कोई app code नहीं)। इसलिए
> **stage-01 = Phase 2 (`foundation`)**, stage-02 = Phase 3, और आगे भी इसी तरह (stage-NN = Phase NN+1)।

## Stages और उनका status (स्थिति)

Status का स्रोत: हर requirement की `requirement.md` में `Status` line, और `git log --oneline`।

| Stage | Phase | Requirement name | क्या देता है (सार) | Status | Commit |
|---|---|---|---|---|---|
| — | 1 | — | Claude Code workflow + docs | done | `e5dce2d`, `708abec` (docs) |
| [stage-01](./stage-01-foundation.md) | 2 | `foundation` | Monorepo, Docker (pgvector + Redis), env, Sequelize + migrations, logging, errors, `/health` और `/ready`, Next.js shell | completed | `f382ca2` |
| [stage-02](./stage-02-sessions-and-join.md) | 3 | `sessions-and-join` | Session बनाना, room code, presenter key, token के साथ join, landing/create/join pages | completed (`requirements/sessions-and-join/requirement.md` line 5), पर **अभी commit नहीं हुआ** — इसकी files git status में untracked/modified हैं | — |
| [stage-03](./stage-03-realtime-backbone.md) | 4 | `realtime-backbone` | Socket.IO + Redis adapter, handshake auth, rooms, presence, state snapshot, reconnect, session end | verified (lint, typecheck, unit, build, integration 110/110); **commit बाक़ी** | — |
| [stage-04](./stage-04-live-polls.md) | 5 | `live-polls` | Polls, lifecycle, transactional voting, live results, visibility | verified (lint, typecheck, unit, build, integration 172/172, live e2e 22/22); **commit बाक़ी** | — |
| [stage-05](./stage-05-word-cloud.md) | 6 | `word-cloud` | Prompts, responses, normalisation, live cloud | verified (lint, typecheck, unit, build, integration 238/238, live e2e 22/22); **commit बाक़ी** | — |
| stage-06 | 7 | `live-qna` | Questions, upvotes, presenter moderation, live ordering | शुरू नहीं हुआ | — |
| stage-07 | 8 | `live-reactions` | Emoji reactions, throttled bursts, per-minute counts | शुरू नहीं हुआ | — |
| stage-08 | 9 | `ai-foundation` | LLM + embeddings providers (real + fake), pgvector, `ai_jobs` runner, budget, kill switch | शुरू नहीं हुआ | — |
| stage-09 | 10 | `knowledge-base-rag` | Upload, chunk, embed, hybrid retrieval, citations | शुरू नहीं हुआ | — |
| stage-10 | 11 | `ai-poll-generator` | Grounded poll suggestions → poll | शुरू नहीं हुआ | — |
| stage-11 | 12 | `ai-qna-copilot` | LangGraph: moderate → dedupe → retrieve → draft → self-check → presenter approval | शुरू नहीं हुआ | — |
| stage-12 | 13 | `ai-live-insights` | Word themes, sentiment pulse, room summary, Pulse Coach | शुरू नहीं हुआ | — |
| stage-13 | 14 | `ai-session-report` | Post-session report, "Ask your session" chat | शुरू नहीं हुआ | — |
| stage-14 | 15 | `mcp-server` | MCP tools, approval-gated actions | शुरू नहीं हुआ | — |
| stage-15 | 16 | — (`/code-review`, `security-reviewer`) | Hardening: QA + security review | शुरू नहीं हुआ | — |
| stage-16 | 17 | `demo-readiness` | Demo seed data, README, two-instance script, rehearsal | शुरू नहीं हुआ | — |

Roadmap के नियम (`docs/08-implementation-plan.md` line 3–4, 34–40): पिछला phase `completed` होने और आपकी approval
के बिना अगला phase शुरू नहीं होता; हर phase के अंत में tests pass, migrations `up`/`down` clean, और commit **आप**
करते हैं (Claude नहीं)।

Short demo path (line 30): 2 → 3 → 4 → 5 → 7 → 9 → 10 → 12 → 11 → 15 → 17।

## Code walkthrough (code की line-by-line व्याख्या)

| File | किस बारे में |
|---|---|
| [../05-code/01-shared.md](../05-code/01-shared.md) | `shared/` package (Zod envelope schemas) |
| [../05-code/02-api-foundation.md](../05-code/02-api-foundation.md) | `api/` की foundation files (env, logger, middleware, app, db, readiness, server) |
| [../05-code/05-tests-docker-env.md](../05-code/05-tests-docker-env.md) | Tests, Docker Compose, `.env.example`, root scripts, ESLint, Prettier |

---

## Stage file का template (ढाँचा)

नया stage लिखते समय नीचे का ढाँचा copy करें। हर तथ्य का स्रोत (file + line number या command) लिखें; जो
पक्का न हो, वहाँ "(पुष्टि नहीं हुई)" लिखें।

```markdown
# Stage NN — <requirement-name>

> स्रोत: `requirements/<name>/requirement.md`, `requirements/<name>/planning-tracking.md`, `git log --oneline`

## लक्ष्य
एक-दो वाक्य: इस stage के बाद क्या संभव होगा (business भाषा में)।

## requirement का सार
- Original request का सार
- Key behaviours (मुख्य व्यवहार) — table या list
- Scope: in / out
- Clarification में पूछे गए सवाल और जवाब
- Success criteria

## plan का सार
- Architecture (ढाँचा)
- Key decisions और D1, D2… (approval वाले फ़ैसले)
- Contracts (HTTP / socket)
- Impact analysis (security, migrations, concurrency)

## tasks table
| # | Task | Complexity | Executor | Status | Notes |
|---|---|---|---|---|---|

Execution groups (कौन सा executor किस क्रम में):
| Group | Tasks | Executor |
|---|---|---|

## files
| File | Create/Modify | काम |
|---|---|---|

## code walkthrough का link
- `../05-code/<NN>-<topic>.md`

## verification (real commands और exit codes)
| Command | नतीजा (exit code / test count) | स्रोत |
|---|---|---|
जो नहीं चला उसे साफ़ "NOT VERIFIED" लिखें। बिना देखे "pass" न लिखें।

## issues
- तारीख · severity · क्या हुआ · कैसे सुलझा / अभी खुला

## अगले कदम
- बचे काम, खुले decisions, अगला stage
```
