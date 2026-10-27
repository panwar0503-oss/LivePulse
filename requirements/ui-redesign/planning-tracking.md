# ui-redesign — Planning & Tracking

> Business requirement: [./requirement.md](./requirement.md)

## Plan (v1) — Clear routes, one design system, connection status

### Architecture
```
Web only. No API, shared schema, socket or DB change.
Routes: /host, /host/[sessionId] (+ knowledge, report), /join, /room/[roomCode], /  (+ not-found)
Redirects: next.config.ts redirects() (308): /create → /host; /presenter/:path+ → /host/:path+; /session/:roomCode → /room/:roomCode
Design system: web/src/components/ui (Icon, LoadingState, ErrorState, ScrollArea, ConnectionStatus, AudienceCount, QrCode, StatusPill, EmptyState, CopyButton, Tabs, AppShell nav slot); sessions/JoinDetails, HostNav, OpenSessionCard
Helpers: lib/routes.ts (all internal paths), lib/recent-sessions.ts (localStorage, never the key), realtime/connection-view.ts
```

### Key decisions
1. Redirects in `next.config.ts` (permanent 308): declarative, keep query strings, no render.
2. Move folders with `git mv`; old folders deleted (approved).
3. One `routes` helper for every internal path.
4. In-repo SVG icon set (no icon package).
5. QR via `uqr@0.1.3` `encode()`, rendered as React SVG with `role="img"` (approved).
6. "Open my session": recent sessions in localStorage (`lp_recent_sessions`, max 5: id, room code, title, createdAt), plus a paste box for host link or session id. Never the key (approved).
7. Connection label from `useSessionSocket().status` through a pure function, ended first. `connecting` (first load) uses the reconnecting tone with the label "Connecting" (approved).
8. Audience count: `AudienceCount` shows N when the API sends a number; otherwise a plain "not shown on this screen" sentence. No API change (approved).
9. Presenter dashboard share card replaced by `JoinDetails`; dashboard connection text removed; status lives once in the header.
10. No `<Button>` component; existing class recipes plus icon children.
11. Hidden scrollbars on `html` and `ScrollArea` (focusable, labelled). Keyboard scrolling kept.
12. Motion: fades and colour transitions under 200 ms; global reduced-motion override.
13. AI: visible strings only. Names, hooks, API clients and test ids do not change.

### Contracts
- No API, shared schema or socket change.
- Web-internal: `StatusTone` 'refused' → 'disconnected'; `PresenterDashboardProps` drops `connection`; `ParticipantViewProps` adds `connectedCount?: number | null`; `CopyButtonProps.className` optional; `TabItem.icon?`; `EmptyStateProps.icon?`, `title?`; `AppShellProps.nav?`.

### Tasks (v1)
| # | Task | Cx | Executor | Depends | Verify |
|---|---|---|---|---|---|
| 1 | globals.css: animation token, `scrollbar-none`, reduced motion | LOW | inline | – | CSS compiles (no `next build` while dev server runs) |
| 2 | `lib/routes.ts` + test | LOW | inline | – | routes test |
| 3 | `Icon.tsx` (about 25 icons) | LOW | executor-low | – | typecheck |
| 4 | UI primitives: StatusPill, StatusMessage, EmptyState, LoadingState, ErrorState, ScrollArea, CopyButton, Tabs, styles | MEDIUM | executor-medium | 1, 3 | ui tests + existing component tests |
| 5 | `connection-view.ts`, ConnectionStatus, AudienceCount + tests | MEDIUM | executor-medium | 4 | connection-view test: every status, ended first |
| 6 | `uqr@0.1.3` install (exact), QrCode.tsx | MEDIUM | executor-medium | 4 | ui test: svg role=img with label |
| 7 | JoinDetails, HostNav, AppShell nav slot, sticky header | MEDIUM | executor-medium | 2, 4, 6 | component tests |
| 8 | Route move (git mv), `routes.*` everywhere, delete old folders, redirects + test | MEDIUM (HIGH risk) | executor-medium | 2 | grep finds no old literal paths; redirect test; typecheck |
| 9 | Home hero, OpenSessionCard, recent-sessions.ts + test; page test | MEDIUM | executor-medium | 7, 8 | page test; recent-sessions test |
| 10 | /host: CreateForm restyle; SessionCreatedPanel with JoinDetails, host link, key warning, remember session | MEDIUM | executor-medium | 7, 9 | sessions-components test; key not in any href |
| 11 | /join restyle; JoinClient → routes.room | LOW | executor-low | 8 | join tests |
| 12 | /host/[id]: header status, HostNav, sticky aside, dashboard restyle, ended, key and not-found views | MEDIUM | executor-medium | 5, 7, 8 | presenter-components test |
| 13 | Presenter tabs: polls, word cloud | MEDIUM | executor-medium | 4 | polls, word-cloud, poll-suggestions tests |
| 14 | Presenter tabs: Q&A, copilot review, clusters | MEDIUM | executor-medium | 4 | qna, copilot-review tests |
| 15 | AI panel and Claude suggestions wording and restyle | LOW | executor-medium | 4 | ai-panel, AiProposals tests |
| 16 | Knowledge and report pages: HostNav, shared states, "Ask your session" | MEDIUM | executor-medium | 7, 8 | knowledge, report tests |
| 17 | /room/[code]: ParticipantView status, AudienceCount, ended, not-found | MEDIUM | executor-medium | 5, 8 | participant-view test |
| 18 | Wording sweep + app/not-found.tsx | LOW | executor-low | 15, 16 | grep for old wording |
| 19 | Docs route names (docs/01, hindi-guide 05-code/04-web.md current-state only) | LOW | executor-low | 8 | grep |
| 20 | Full check: typecheck, web tests, `next build`; manual redirect check, keyboard scroll, 375px | MEDIUM | executor-medium | all | each command seen passing |

### Approvals
- Approved 2026-10-25: all 20 tasks; `uqr@0.1.3` exact in web; deleting old folders after git mv; localStorage recent list; "not shown" audience count; "Connecting" label.

### Risks
| Level | Risk | Mitigation |
|---|---|---|
| HIGH | Shared old link breaks | `:path+` rules; one test per rule; manual `curl -I` on old forms |
| MEDIUM | Missed literal path | `routes.ts` everywhere; grep check |
| MEDIUM | Status misleads presenter | One pure mapping, tested per state |
| MEDIUM | Restyle changes behaviour | No prop or behaviour changes in panels; full web suite plus build |
| LOW | Hidden scrollbars hide content | Scroll works; focusable; fade hint |
| LOW | localStorage unavailable | try/catch; Zod-parse entries |

## Tasks (status)
| # | Status | Notes |
|---|---|---|
| 1 | done | globals.css: fade-in token, `scrollbar-none`, html scrollbar hidden, reduced-motion block (not yet compiled by `next build`) |
| 2 | done (verified) | lib/routes.ts + routes.test.ts 4/4 exit 0 |
| 3 | done (verified) | Icon.tsx + icon.test 3/3 exit 0; typecheck exit 0. The test's element check accepts path, rect or circle (stop icon uses rect) |
| 4, 5 | done (verified) | UI primitives; connection-view, ConnectionStatus, AudienceCount. typecheck exit 0; full web 227/227 exit 0 (31 files). `refused` renamed to `disconnected` in three callers. Check `stickyAsideClass` top offset against the header height |
| 6 | install done | `uqr@0.1.3` installed exact in web (approved). `npm audit --workspace web`: 3 findings (postcss high, zod high, 1 moderate), none from uqr; pre-existing; `audit fix --force` is breaking, not run |
| 6, 7 | done (verified) | QrCode; JoinDetails, HostNav, AppShell nav slot. typecheck exit 0; narrow 24/24 exit 0; full web 236/236 exit 0 (34 files) |
| 10 | done (verified) | /host create and share panel. sessions-components 11/11 exit 0; full web 253/253 exit 0; filtered typecheck 0. Gap: remember-session effect not tested (renderToStaticMarkup runs no effects) |
| 12 | done (verified) | /host/[id]. presenter-components 14/14 exit 0; full web 253/253 exit 0; filtered typecheck 0. Gaps: no test for the not-found links or the ended-state AI panel hide (both render only in effects) |
| 13 | done (verified on combined run) | polls and word cloud restyle; no test strings changed. Full web 253/253 exit 0 after 13 and 14 together; filtered typecheck 0 |
| 17 | done (verified on combined run) | audience room: ConnectionStatus and AudienceCount in ParticipantView; RoomNotFound (new); icons on tabs; ended hides activities. One test string changed: "Reconnecting…" → "Reconnecting" (plan wording). Added 3 tests. Full web 256/256 exit 0; filtered typecheck 0. Note: Prettier reformatted SessionCreatedPanel.tsx; check that diff |
| 18 | done (verified) | wording sweep (AiProposals, JoinForm, CreateForm labels); not-found page added with test. Full web 258/258 exit 0 |
| 19 | done | current-state docs updated to the new routes (docs/01, hindi-guide). Historical logs left as they were |
| Browser | done (partial) | `@playwright/test@1.64.0` exact (dev dep in web, approved; published 2026-10-07; 1.64.1 excluded as under two weeks old). Chromium downloaded. web/playwright.config.ts and web/e2e/ui-redesign.spec.ts added. Run against the dev API (4000) and web dev server (3000): 5/5 passed (exit 0): no sideways scroll at 375px on /, /host, /join; page scrollbar hidden; create session → join details + QR shown → open room → Live, no key in the URL. Not done: reconnect state (needs stopping the API), ended state, keyboard scroll in panels |
| 20 | done except manual browser checks | full web 258/258 exit 0; filtered typecheck 0; `npm run build -w web` exit 0 (routes /host, /host/[sessionId], /host/[sessionId]/knowledge, /host/[sessionId]/report, /join, /room/[roomCode]); redirects checked on a built server: /create, /presenter/<id>, /presenter/<id>/report, /session/<code> and with a query string all return 308 to the new path; /join 200. Not done: real browser pass (scrollbars hidden, 375px, keyboard scroll, reconnect states) |
| 15 | verified on combined run (full web 256/256 exit 0, typecheck 0) | AI panel wording and restyle. Test strings changed in AiProposals.test.tsx only ("Proposed by Claude" → "Claude suggestions"; "Failed:" → "Could not finish:"). Agent's full run failed in knowledge.test.tsx and participant-view.test.tsx, both being edited by tasks 16/17 at the time; to re-check after they finish |
| 16 | reported; full-suite verification pending | knowledge and report pages; PresenterKeyNeeded added; use-knowledge exposes authRequired. Agent: full web 256/256 exit 0; no test strings changed |
| 14 | done (verified on combined run) | Q&A and copilot restyle; no test strings changed. Gaps: Pin has no icon (no pin glyph in Icon); Ask and Upvote have no icon (tests match the exact text after the button tag) |
| 11 | done (verified) | /join restyle (JoinForm; duplicate h1 removed from join page; JoinClient already uses routes.room). sessions-components 11/11 exit 0; full web 253/253 exit 0. A transient typecheck error in host/page.tsx seen mid-run cleared on recheck (0 errors) |
| 9 | done (verified) | home hero, OpenSessionCard, recent-sessions.ts + tests. Narrow 14/14 exit 0; full web 252/252 exit 0; typecheck errors outside .next: 0. Decision: parseHostTarget accepts http/https on any host when the path is /host/<uuid> or /presenter/<uuid> (only the id is used; navigation stays on this app) |
| 8 | done except typecheck (blocked) | Route move (git mv for tracked, mv for untracked); old folders removed; routes helper everywhere; three permanent redirects in next.config.ts; redirects test 8/8 exit 0 (redirects+routes); full web 240/240 exit 0. Typecheck web exit 2: 10 errors only in gitignored web/.next/types/app/{create,presenter,session} (stale generated types; `next typegen` does not prune them). Deleting those 3 folders was approved by the developer but the Bash permission was denied; not retried, not bypassed |
| 4–20 | pending | |

## Issues & updates
<!-- Only when issues are found after delivery: date, severity, technical description, resolution. -->

## Plan (v2) / Tasks (v2)
<!-- Only if a replan is needed. Never overwrite v1. -->

## Change log
| Date | Type | Description | Files |
|---|---|---|---|
| 2026-10-25 | plan_created | Plan v1 from planner; 20 tasks; four decisions | planning-tracking.md |
| 2026-10-26 | migrated | Dev DB `livepulse`: applied the 7 pending forward migrations (create-knowledge-documents, create-knowledge-passages, create-question-clusters, add-qna-copilot-columns-to-questions, create-ai-answer-drafts, create-session-chat-turns, create-ai-actions). Status: none pending. Approved by the developer. Down never run on dev | api/migrations |
| 2026-10-26 | verified | Browser checks via Playwright 1.64.0 exact (approved): 5/5 exit 0 against dev servers. Live states check (one-off script, outside the repo, servers it started were stopped): live → Reconnecting after the API was stopped → back to Live after restart → ended after End session + Confirm, "This session has ended." shown. Keyboard scroll checked later (one-off script, outside the repo): the presenter "Questions list" region takes keyboard focus (tabindex 0), overflows its panel, hides its scrollbar, and PageDown scrolls it (0 → 560). Seeded with 5 questions per participant limit (QUESTION_LIMIT_REACHED is intended) | web/playwright.config.ts, web/e2e/ui-redesign.spec.ts, web/package.json |
| 2026-10-26 | verified | Final: web tests 258/258 exit 0; web typecheck exit 0 unfiltered (the stale .next errors cleared after `next build`); web build exit 0; web build exit 0; redirects 308 verified on a built server. Browser checks not done. Gaps: hook behaviours untested; ended-state AI hide and not-found links untested (effects) | planning-tracking.md |
| 2026-10-25 | approved | Plan v1 approved: all tasks; uqr@0.1.3; delete old folders after git mv; localStorage recent list; audience count "not shown"; "Connecting" label | planning-tracking.md |
