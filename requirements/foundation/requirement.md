# Feature: Project foundation

## Metadata
- **Name**: foundation
- **Status**: completed
- **Current phase**: initial
- **Created**: 2026-10-23 · **Last updated**: 2026-10-23

## Original request
Set up the LivePulse project skeleton so later features can be built and tested: npm workspaces (api, web, shared)
with TypeScript, Prettier/ESLint, Docker Compose for PostgreSQL with the pgvector extension and Redis (health checks,
persistent volume), env validation with Zod and an `.env.example` with placeholders only, Express app with structured
logging, request IDs, consistent error envelope, Helmet and CORS allowlist, Sequelize connection plus a migration runner
(no sync), `GET /health` and `GET /ready` (PostgreSQL + Redis status, no secrets), a Next.js App Router + Tailwind shell
with a landing page placeholder, and Vitest + Supertest wired with one passing test per workspace. No product features yet.

## What it does
A developer can clone the project, start the local services with one command, and run the backend and web shell. The
backend tells operators whether it is alive and whether its required services are reachable, without revealing any
secrets. Schema changes are made only through versioned migrations that can be applied and reverted. Nothing a visitor
can use is built yet.

## Who uses it
- **Developer (evaluator)** — sets up the project, runs it, runs the checks, and reads the health endpoints.
- **Operator** — reads `/health` and `/ready` to know whether the service is up and whether it can serve requests.

## User stories
1. As a developer, I want to start PostgreSQL and Redis with one command so that I can run the project locally in minutes.
2. As a developer, I want schema changes applied and reverted by versioned migrations so that the database can be rebuilt from scratch.
3. As an operator, I want `/ready` to report a dependency that is down so that I can stop traffic before users see errors.
4. As a developer, I want the web shell to load and the test commands to pass so that I know the skeleton works before features arrive.

## Key behaviours
| # | Behaviour | Notes |
|---|---|---|
| 1 | Local PostgreSQL (with vector support) and Redis start with one command and report healthy | Data survives a container restart |
| 2 | Backend refuses to start if required settings are missing or invalid | Error names the missing setting, never prints its value |
| 3 | Backend refuses to start if Redis cannot be reached | Prevents silent loss of cross-instance updates later |
| 4 | `/health` returns OK while the process runs | Reveals no versions, hosts, or configuration |
| 5 | `/ready` returns OK only when PostgreSQL and Redis are reachable | Returns 503 with a generic status when a dependency is down |
| 6 | Every error response uses the same shape and carries a request ID | No stack traces or database details reach the client |
| 7 | Requests from origins not on the allowlist are refused by the browser | Allowlist comes from configuration |
| 8 | Migrations create and revert the schema on an empty database | No automatic schema sync |
| 9 | The web app shows a placeholder landing page | No product features, no fake data |
| 10 | Test commands run per workspace and pass | Each workspace has at least one meaningful test |

## User flows
### Flow 1: First-time local setup
1. Developer copies the example settings file and fills in local values.
2. Developer starts the local services.
3. Developer installs dependencies and applies migrations.
4. Developer starts the backend and web app.
5. Developer opens the landing page and checks `/health` and `/ready` return OK.

### Flow 2: Dependency outage
1. Redis stops while the backend runs.
2. `/ready` returns 503 with a generic status.
3. Redis is started again and `/ready` returns OK without restarting the backend.

## Real-time behaviour
None in this phase. Real-time arrives in the realtime-backbone phase.

## Scope
**In scope**
- Monorepo workspaces for backend, web, and shared contracts
- Local PostgreSQL (with vector support) and Redis services
- Environment validation and an example settings file with placeholders only
- Backend skeleton: logging, request IDs, error envelope, security headers, origin allowlist
- Database connection and versioned migration runner
- Liveness and readiness endpoints
- Web shell with a landing placeholder
- Lint, format, and test setup with one passing test per workspace

**Out of scope**
- Any product feature: sessions, participants, polls, votes, word cloud, Q&A, reactions, AI
- Real-time events and Socket.IO wiring (dependency installed only; not used)
- Authentication and presenter keys
- Deployment, CI pipelines, and production configuration
- Any data model beyond the migration runner's own bookkeeping

## Assumptions
1. Migrations use sequelize-cli — chosen by the developer.
2. Redis is required; the backend fails fast when it is unreachable at startup — chosen by the developer.
3. Web scope is the shell and placeholder landing page only — chosen by the developer.
4. The approved dependency list is the foundation's package set; any other package returns for approval.
5. Docker Desktop is available on the developer's machine for verification.

## Risks
- **HIGH**: Local Docker is not running, so services and migrations cannot be verified. Mitigation: verification steps are marked not-run until Docker is up.
- **MEDIUM**: The pgvector image or extension setup differs by platform. Mitigation: the extension itself is created in a later phase; this phase only verifies the image starts.
- **MEDIUM**: Fail-fast Redis makes the first local start harder if Redis is misconfigured. Mitigation: clear startup error and documented setup steps.
- **LOW**: Tooling version drift between workspaces. Mitigation: pin versions in the plan.

## Non-functional requirements (user-facing)
- A new developer reaches a running landing page in under 15 minutes on a clean checkout with Docker available.
- `/health` responds in under 100 ms locally.

## Success criteria
1. Local PostgreSQL and Redis start with one command and both report healthy.
2. The backend fails with a clear message when a required setting is missing, without printing its value.
3. The backend fails to start when Redis is stopped.
4. `GET /health` returns 200 with no version or host details.
5. `GET /ready` returns 200 with both dependencies up, and 503 when Redis is stopped.
6. An error response contains a request ID and no stack trace.
7. Migrations apply on an empty database and revert cleanly.
8. The web landing page loads locally.
9. The test commands for backend, web, and shared pass.

## Enhancements
| Name | Summary | Status |
|---|---|---|

## Change log
| Date | Change |
|---|---|
| 2026-10-23 | Created and confirmed (migration runner, Redis policy, web scope, dependency list) |
| 2026-10-24 | Completed. Verified: lint, typecheck, all tests, live health/ready incl. Redis outage, web build and dev server. Partial: criterion 7 (no migrations exist yet, so revert is shown only as a no-op); SIGINT/SIGTERM shutdown not verified. See planning-tracking.md Issues. |
