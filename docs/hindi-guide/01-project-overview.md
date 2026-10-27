# 01 — प्रोजेक्ट परिचय (Project Overview)

> यह गाइड उन developers के लिए है जो basic Node.js जानते हैं पर LivePulse में नए हैं।
> मुख्य स्रोत: `CLAUDE.md`, `docs/01-product-requirements.md`, `docs/08-implementation-plan.md`,
> `requirements/foundation/*`, `requirements/sessions-and-join/*`।

## 1. LivePulse क्या है?

LivePulse एक **live audience engagement prototype** है। मतलब: एक presenter (वक्ता) live session चलाता है, और
audience (दर्शक) अपने browser से एक room code डालकर जुड़ते हैं। फिर वे polls, word cloud, Q&A और reactions के
ज़रिए हिस्सा लेते हैं, और सब कुछ live update होता है (`docs/01-product-requirements.md` §1)।

- यह **StreamAlive से प्रेरित (inspired)** है, लेकिन एक **original product** है।
  StreamAlive की branding, assets, code या हूबहू page design कॉपी नहीं करनी है (`docs/01` §1)।
- यह सिर्फ **web + backend** है। कोई mobile app नहीं (`CLAUDE.md`)।
- आगे के phases में एक **AI co-pilot** जुड़ेगा, जो presenter की मदद करेगा — पर AI सिर्फ draft बनाता है,
  presenter की मंज़ूरी के बिना audience तक कुछ नहीं जाता (`docs/01` §2, `CLAUDE.md`)।

## 2. किसके लिए है?

| भूमिका (Role) | कौन | क्या करता है |
|---|---|---|
| **Presenter** (host) | Session चलाने वाला | Session बनाता है, room code और join link बाँटता है, dashboard देखता है, session ख़त्म करता है |
| **Participant** (audience) | दर्शक | Room code + display name से join करता है; कोई account नहीं चाहिए |
| **Visitor** | कोई भी | Landing page खोलता है; Create या Join चुनता है |
| **Evaluator** (CTO / reviewer) | Demo देखने वाला | App को local चलाता है, demo script follow करता है, architecture और trade-offs पढ़ता है, tests चलाता है |

इस prototype का असली दर्शक **CTO और engineering leaders** हैं, जो product और engineering की गहराई परखते हैं
(`docs/01` §1)। यानी यह एक **CTO demo** है।

## 3. अभी तक क्या बन चुका है?

| Phase | Requirement | Status | सबूत |
|---|---|---|---|
| 1 | — (Claude Code workflow + docs) | ✔ done | `docs/08` |
| 2 | `foundation` | ✔ completed (कुछ हिस्से partial) | `requirements/foundation/requirement.md` change log |
| 3 | `sessions-and-join` | ✔ completed (real browser check बाकी) | `requirements/sessions-and-join/requirement.md` change log |

### Phase 2 — `foundation` में क्या मिला
- npm workspaces: `api`, `web`, `shared` (monorepo)।
- Docker Compose: PostgreSQL (`pgvector/pgvector:pg16` image) और Redis (`redis:7`), health checks के साथ।
- Env validation (Zod से) और `.env.example` में सिर्फ placeholders।
- Express app: structured logging (pino), request ID, एक जैसा error envelope, Helmet, CORS allowlist।
- Sequelize connection + migration runner (sequelize-cli), `sync()` नहीं।
- `GET /health` और `GET /ready` endpoints।
- Next.js App Router + Tailwind का shell।
- Verified: lint, typecheck, सारे tests, live `/health` और `/ready` (Redis बंद करने पर 503, फिर अपने-आप 200)।
- **पुष्टि नहीं हुई:** SIGINT/SIGTERM पर graceful shutdown (देखें `11-known-issues.md`)।

### Phase 3 — `sessions-and-join` में क्या मिला
- Presenter title (और वैकल्पिक description) देकर session बनाता है।
- उसे मिलता है: 6 अक्षरों का **room code**, एक **join link**, और एक **presenter key** — जो सिर्फ **एक बार** दिखती है।
- बनाने वाला browser cookie से presenter के रूप में पहचाना जाता है; दूसरे device पर presenter key एक बार डालनी पड़ती है।
- Participant room code + display name से join करता है; page refresh करने पर भी वही पहचान रहती है।
- Presenter dashboard: title, status, code, join link, कितने लोग join हुए (count), और "End session"।
- Session ख़त्म करना **final** है — उसके बाद कोई join नहीं कर सकता।
- Create, join और presenter-key पर rate limit।
- Verified: 58 integration tests, 35 web tests, 49 unit tests, और 12-step HTTP flow
  (`requirements/sessions-and-join/planning-tracking.md` change log)।
- **पुष्टि नहीं हुई:** असली browser में ports 3000 और 4000 के बीच cookie का व्यवहार, clipboard copy, end-confirmation click flow।

## 4. आगे का Roadmap (`docs/08-implementation-plan.md` से)

| Phase | Requirement | क्या देगा |
|---|---|---|
| 4 | `realtime-backbone` | Socket.IO + Redis adapter, handshake auth, rooms, presence, state snapshot, reconnect |
| 5 | `live-polls` | Polls, lifecycle, transaction वाली voting, live results |
| 6 | `word-cloud` | Prompts, responses, normalisation, live cloud |
| 7 | `live-qna` | Questions, upvotes, presenter moderation |
| 8 | `live-reactions` | Emoji reactions, throttled bursts |
| 9 | `ai-foundation` | LLM + embeddings providers (real + `fake`), pgvector, ai_jobs runner, budget, kill switch |
| 10 | `knowledge-base-rag` | Upload, chunk, embed, hybrid retrieval, citations |
| 11 | `ai-poll-generator` | Material पर आधारित poll सुझाव |
| 12 | `ai-qna-copilot` | LangGraph: moderate → dedupe → retrieve → draft → self-check → presenter approval |
| 13 | `ai-live-insights` | Themes, sentiment pulse, room summary |
| 14 | `ai-session-report` | Post-session report, "Ask your session" chat |
| 15 | `mcp-server` | Claude Desktop/Code के लिए MCP tools, approval-gated actions |
| 16 | — | Hardening: QA + security review |
| 17 | `demo-readiness` | Demo seed data, README, two-instance script, rehearsal checklist |

**समय कम हो तो न्यूनतम demo रास्ता:** 2 → 3 → 4 → 5 → 7 → 9 → 10 → 12 → 11 → 15 → 17 (`docs/08`)।

नियम: अगला phase तभी शुरू होगा जब पिछला `completed` हो और developer मंज़ूरी दे (`CLAUDE.md`, `docs/08`)।

## 5. क्या Out of Scope है?

पूरे प्रोजेक्ट के लिए (`docs/01` §4, `docs/08` "Non-goals"):
- Zoom/Teams/Meet/YouTube integrations, video overlays।
- Accounts, SSO, payments, billing, multi-tenant orgs।
- Native mobile apps।
- Model fine-tuning; अलग vector database (pgvector ही PostgreSQL में रहेगा)।
- Kubernetes, microservices, production HA।
- StreamAlive से पूरी बराबरी (maps, spin-the-wheel, leaderboard quizzes)।

सिर्फ `sessions-and-join` phase में बाहर रखा गया (`requirements/sessions-and-join/requirement.md` Scope):
- Live presence और live updates (Phase 4 में आएँगे)।
- Ended session को दोबारा खोलना, title edit करना, participants हटाना।
- User accounts या किसी की पहचान verify करना।

## 6. Demo में क्या दिखेगा?

**अभी (Phase 3 तक), browser में:**
1. Landing page `/` पर "Create session" और "Join session"।
2. `/host` पर title डालें → room code, join link और presenter key (एक बार) दिखेंगे।
3. दूसरे browser में `/join` पर code + नाम डालें → `/room/[roomCode]` पर पहुँचें।
4. Refresh करें → पहचान बनी रहती है।
5. `/host/[sessionId]` dashboard पर joined count (page refresh पर update होता है — live नहीं)।
6. "End session" → नया join मना हो जाता है, generic "not found or not open" message के साथ।
7. Ops: `curl localhost:4000/health` और `/ready`; Redis रोकने पर `/ready` 503 देता है।

**आगे के phases के बाद (लक्ष्य, अभी बना नहीं है):** live polls और Q&A, AI poll suggestions, RAG से grounded
answers, और Claude Desktop से MCP के ज़रिए session चलाना (`docs/08` minimum demo path)।
