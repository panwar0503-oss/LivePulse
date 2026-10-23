---
name: implementation-order
description: Order to build a LivePulse feature across shared contracts, Sequelize, Express API, Socket.IO, and Next.js so each step is testable.
---

# Implementation order

Build bottom-up so every step compiles and can be tested before the next depends on it.

| # | Layer | Location (proposed) | Done when |
|---|---|---|---|
| 1 | Shared contracts | `shared/src/schemas/<feature>.ts`, `shared/src/events/<feature>.ts` | Zod schemas + inferred types + event maps exported |
| 2 | Migration | `api/migrations/<timestamp>-<name>.(js\|ts)` via the CLI script | `up` and `down` both run on a test DB |
| 3 | Model + associations | `api/src/models/<entity>.model.ts`, `models/index.ts` | matches migration; model unit test |
| 4 | Service | `api/src/services/<feature>.service.ts` | business rules, authz on loaded records, transactions; unit/integration tests |
| 5 | Validation + controller + route | `api/src/validation/`, `controllers/`, `routes/` | Supertest: success, 400, 401/403, 404, 409 |
| 6 | Realtime handlers | `api/src/realtime/<feature>.handlers.ts` | socket tests: auth, room isolation, ack errors, emit after commit |
| 7 | Web API client + hooks | `web/src/lib/api/`, `web/src/hooks/`, `web/src/realtime/` | typed with shared schemas; hook tests |
| 8 | Components + page | `web/src/components/<feature>/`, `web/src/app/.../page.tsx` | loading/error/empty/success states; component tests |
| 9 | Docs + tracking | `requirements/<feature>/`, `docs/` if architecture changed | status and change log updated |

Rules:
- Skip layers the feature doesn't touch. Never write web code against an endpoint that doesn't exist yet unless
  the contract in `shared/` is final.
- Tests travel with each layer — don't batch them at the end.
- Migrations are created with the project's CLI script (never hand-named timestamps) and never edited after
  they've been run elsewhere.
- Contract change mid-way → update `shared/` first, then every consumer in the same task.
