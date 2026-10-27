# LivePulse — Configuration Reference

Version: prototype · Date: 2026-10-27

This file is the complete reference for LivePulse configuration. It lists every setting the code reads, with its type,
allowed range, default and meaning, and every package and runtime version the project uses. The names, defaults and rules come
from the code: `api/src/config/env.ts` (API), `web/src/lib/config.ts` (web) and `docker-compose.yml` (containers). The
specification is in [`docs/specification/livepulse-specification.md`](../specification/livepulse-specification.md).

---

## 1. Where configuration lives

| File or place | Read by | Committed to git | Purpose |
| --- | --- | --- | --- |
| `.env` (repo root) | API (`api/`) and Docker Compose | **No** (ignored by `.gitignore`) | Local values for the API and the database containers |
| `web/.env.local` | Next.js web app | **No** (ignored by `.gitignore`) | Web-only values, such as `NEXT_PUBLIC_API_URL` |
| MCP client configuration (for example the Claude Desktop entry) | MCP server (`npm run mcp -w api`) | Not in this repo | Presenter tools: API URL, session id, presenter key |

Rules that apply to every file:

- Never commit a file that holds real values.
- Never print or paste secret values into logs, tickets or chats.
- Values are read once at startup. Restart the process after you change a value.
- A variable prefixed `NEXT_PUBLIC_` is sent to the browser. Never put a secret in one.

### 1.1 Minimum `.env` to start the API

Create `.env` at the repo root with at least these settings. All others have defaults (sections 3 to 5).

```
WEB_ORIGIN=http://localhost:3000
DATABASE_URL=postgres://livepulse:<your-password>@localhost:5432/livepulse
REDIS_URL=redis://localhost:6379
POSTGRES_USER=livepulse
POSTGRES_PASSWORD=<your-password>
POSTGRES_DB=livepulse
```

`<your-password>` is a placeholder; choose a real value locally. `POSTGRES_PASSWORD` and the password inside `DATABASE_URL`
must be the same.

### 1.2 Minimum `web/.env.local` for the web app

```
NEXT_PUBLIC_API_URL=http://localhost:4000
```

This value is optional in development, because the default is `http://localhost:4000`. Set it explicitly so the browser
and the API agree, and always set it in production.

---

## 2. Startup validation

The API validates its settings with Zod when it starts (`api/src/config/env.ts`):

- Every rule in sections 3 to 5 is enforced. A missing required value, or a value outside its range, stops the server.
- The error names the setting that failed, for example `Invalid environment configuration: PORT`. It never prints the value.
- Two cross-field rules apply:
  - `AI_PROVIDER=anthropic` requires `ANTHROPIC_API_KEY`.
  - `EMBEDDINGS_DIM` must equal the shared embedding size, `384`.
- The API also refuses to start if Redis is unreachable at startup.

The web app validates `NEXT_PUBLIC_API_URL` when it loads (section 6).

---

## 3. Core settings (API)

| Variable | Type | Required | Default | Allowed values and rules | Meaning |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | enum | No | `development` | `development`, `test`, `production` | Runtime mode. In `production` the auth cookies also get the `Secure` flag (specification §7) |
| `PORT` | integer | No | `4000` | 1 to 65535 | Port the API listens on |
| `WEB_ORIGIN` | string | **Yes** | — | One or more origins separated by commas. Each must start with `http://` or `https://` | Origins allowed to call the API. Used by CORS and the origin check on writes |
| `DATABASE_URL` | string | **Yes** | — | Must start with `postgres://` or `postgresql://` | PostgreSQL connection string |
| `TEST_DATABASE_URL` | string | Integration tests only | — | Must start with `postgres://` or `postgresql://`. The database name must end in `_test` | Database used only by the integration suite. The suite refuses any other name |
| `REDIS_URL` | string | **Yes** | — | Must start with `redis://` or `rediss://` | Redis connection used by the Socket.IO adapter and readiness check |
| `TRUST_PROXY` | enum | No | `false` | `true` or `false` | Set `true` only behind a reverse proxy, so the client address used for rate limits is correct. Leave `false` otherwise |
| `LOG_LEVEL` | enum | No | `info` | `trace`, `debug`, `info`, `warn`, `error`, `fatal` | Log detail. Logs never contain secrets, tokens or request bodies |

---

## 4. Realtime settings (API)

| Variable | Type | Required | Default | Allowed values and rules | Meaning |
| --- | --- | --- | --- | --- | --- |
| `PRESENCE_GRACE_MS` | integer (milliseconds) | No | `5000` | 0 to 60000 | Delay after a participant's last disconnect before the presence count goes down. Stops a page refresh from making the count flicker |
| `SOCKET_MAX_PER_IP` | integer | No | `20` | 1 to 1000 | Open live connections allowed per client address |
| `SOCKET_MAX_PER_SESSION` | integer | No | `500` | 1 to 10000 | Open live connections allowed per session on one API instance |

---

## 5. AI settings (API)

| Variable | Type | Required | Default | Allowed values and rules | Meaning |
| --- | --- | --- | --- | --- | --- |
| `AI_ENABLED` | enum | No | `true` | `true` or `false` | Global AI switch for the process. `false` turns off every AI job and AI route |
| `AI_PROVIDER` | enum | No | `fake` | `fake` or `anthropic` | `fake` is offline and free and is used by all tests. `anthropic` calls the real Claude API |
| `ANTHROPIC_API_KEY` | string | Required when `AI_PROVIDER=anthropic` | — | At least 1 character | Anthropic API key. Never logged, never sent to the browser |
| `AI_MODEL` | string | No | `claude-opus-5-5` | 1 to 100 characters | Claude model id used for drafting, poll suggestions and the report chat |
| `EMBEDDINGS_PROVIDER` | enum | No | `fake` | `local` or `fake` | `local` runs a Transformers.js model on this machine. `fake` is deterministic and offline |
| `EMBEDDINGS_MODEL` | string | No | `Xenova/all-MiniLM-L6-v2` | 1 to 200 characters | Local embedding model. Downloaded once (about 23 MB) and cached. Used when `EMBEDDINGS_PROVIDER=local` |
| `EMBEDDINGS_DIM` | integer | No | `384` | Must equal `384` | Embedding vector size. Changing it needs a database migration and re-embedding of all passages |
| `RERANKER_PROVIDER` | enum | No | `fake` | `fake` or `local` | Re-scores knowledge search candidates. `local` downloads a cross-encoder model once; it shares the embeddings model cache |
| `RERANKER_MODEL` | string | No | `Xenova/ms-marco-MiniLM-L-6-v2` | 1 to 200 characters | Reranker model used when `RERANKER_PROVIDER=local` |
| `AI_MAX_CONCURRENCY` | integer | No | `2` | 1 to 16 | AI jobs running at the same time on one instance |
| `AI_MAX_ATTEMPTS` | integer | No | `3` | 1 to 10 | Attempts per AI job before it fails permanently |
| `AI_SESSION_TOKEN_BUDGET` | integer (tokens) | No | `200000` | 1 to 10000000 | Tokens allowed per session. Jobs are skipped once the budget is used up |
| `QNA_DUPLICATE_SIMILARITY` | number | No | `0.90` | 0.5 to 1 | A new question at or above this similarity to an existing one is merged into it |
| `QNA_CLUSTER_SIMILARITY` | number | No | `0.75` | 0.5 to 1 | Questions at or above this similarity share a cluster |
| `OPERATOR_KEY` | string | No | — | At least 32 characters | Key for the operator route `PATCH /api/ops/ai`. Without it that route answers 503 |

---

## 6. Web settings (Next.js)

| Variable | Type | Required | Default | Allowed values and rules | Meaning |
| --- | --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | string (URL) | Yes in production | `http://localhost:4000` in development | Must start with `http://` or `https://`, with no trailing slash | API base URL the browser calls. Public: it must never hold a secret |

Notes:

- Next.js reads this value from `web/.env.local`, not from the repo-root `.env`.
- In production there is no default. If the value is missing or invalid, the web app stops with a message that names the variable.
- A `next build` without this value still succeeds; the check runs when the app starts.

---

## 7. Docker Compose settings

`docker-compose.yml` reads these from the repo-root `.env` to start the local containers.

| Variable | Required | Meaning |
| --- | --- | --- |
| `POSTGRES_USER` | Yes | Database user created in the PostgreSQL container |
| `POSTGRES_PASSWORD` | Yes | Password for that user. Must match the password in `DATABASE_URL` |
| `POSTGRES_DB` | Yes | Database created in the container. Must match the database in `DATABASE_URL` |

Containers and ports started by `docker compose up -d`:

| Service | Image | Host port | Health check |
| --- | --- | --- | --- |
| `postgres` | `pgvector/pgvector:pg16` | `5432` | `pg_isready` every 5 seconds |
| `redis` | `redis:7` | `6379` | `redis-cli ping` every 5 seconds |

On Windows, ports 5432 and 6379 must be free. If another local PostgreSQL or Redis is running, stop it or change the host
port in `docker-compose.yml`. If you change the host port, change `DATABASE_URL` and `REDIS_URL` to match.

---

## 8. MCP server settings (not in `.env`)

Set these in the MCP client configuration (for example the Claude Desktop entry), not in `.env`.

| Variable | Required | Meaning |
| --- | --- | --- |
| `LIVEPULSE_API_URL` | Yes | Base URL of the API, for example `http://localhost:4000` |
| `LIVEPULSE_SESSION_ID` | Yes | The session the tools act on |
| `LIVEPULSE_PRESENTER_KEY` | Yes | The presenter key of that session. Each session has one presenter key |

The MCP server calls the REST API with the presenter key. It holds no database connection. See the specification,
section 4.9. Setup steps are in [`docs/guides/mcp-claude-desktop-setup.md`](../guides/mcp-claude-desktop-setup.md).

---

## 9. Package and runtime versions

### 9.1 Runtime and infrastructure

| Item | Version | Source |
| --- | --- | --- |
| Node.js (minimum declared) | 20 or later | Root `package.json` `engines` field |
| Node.js (needed by `unpdf`) | 22.18 or later | Specification §11.1 and §12. Open item: the `engines` field does not reflect it yet |
| Node.js (installed on the machine used to write this file) | 24.22.1 | `node --version` |
| npm (installed) | 11.19.1 | `npm --version` |
| PostgreSQL image | `pgvector/pgvector:pg16` (PostgreSQL 16 with pgvector) | `docker-compose.yml` |
| Redis image | `redis:7` | `docker-compose.yml` |

### 9.2 Root workspace (`livepulse`, version 0.0.0)

Development tools shared by all workspaces.

| Package | Declared range | Installed |
| --- | --- | --- |
| `typescript` | ^5.6.0 | 5.9.3 |
| `eslint` | ^9.0.0 | 9.39.5 |
| `@eslint/js` | ^9.0.0 | 9.39.5 |
| `typescript-eslint` | ^8.0.0 | 8.72.0 |
| `prettier` | ^3.3.0 | 3.9.10 |

### 9.3 API workspace (`@livepulse/api`, version 0.0.0)

Runtime dependencies:

| Package | Declared | Installed | Used for |
| --- | --- | --- | --- |
| `express` | ^5.0.0 | 5.3.0 | HTTP server and routing |
| `socket.io` | ^4.8.0 | 4.8.4 | Realtime connections |
| `@socket.io/redis-adapter` | ^8.3.0 | 8.3.0 | Sends realtime events across API instances through Redis |
| `redis` | ^4.7.0 | 4.7.1 | Redis client |
| `sequelize` | ^6.37.0 | 6.37.8 | ORM, models and transactions |
| `pg` | ^8.11.0 | 8.23.1 | PostgreSQL driver |
| `zod` | ^3.25.32 | 3.25.76 | Validation of input and of model output |
| `helmet` | ^8.0.0 | 8.3.0 | Security headers |
| `cors` | ^2.8.5 | 2.8.6 | Cross-origin rules |
| `pino` | ^9.0.0 | 9.14.0 | Structured logging |
| `@huggingface/transformers` | 4.3.1 (exact) | 4.3.1 | Local embeddings and reranker models (Transformers.js) |
| `@langchain/core` | 1.3.0 (exact) | 1.3.0 | LangChain core abstractions |
| `@langchain/langgraph` | 1.4.21 (exact) | 1.4.21 | Q&A co-pilot state machine |
| `@langchain/anthropic` | 1.6.0 (exact) | 1.6.0 | Claude model provider |
| `@modelcontextprotocol/sdk` | 1.32.1 (exact) | 1.32.1 | MCP server |
| `unpdf` | 1.8.1 (exact) | 1.8.1 | PDF text extraction |
| `@livepulse/shared` | `*` (workspace) | workspace | Shared schemas and contracts |

Development dependencies:

| Package | Declared | Installed | Used for |
| --- | --- | --- | --- |
| `vitest` | ^2.1.0 | 2.1.9 | Test runner |
| `supertest` | ^7.0.0 | 7.3.1 | HTTP integration tests |
| `socket.io-client` | ^4.8.4 | 4.8.4 | Socket.IO tests |
| `tsx` | ^4.19.0 | 4.23.15 | Runs TypeScript directly (scripts) |
| `sequelize-cli` | ^6.6.0 | 6.6.5 | Migration commands |
| `typescript` | ^5.6.0 | 5.9.3 | Compiler |
| `@types/node` | ^20.0.0 | 20.19.43 | Node type definitions |
| `@types/express` | ^5.0.0 | 5.0.6 | Express type definitions |
| `@types/cors` | ^2.8.17 | 2.8.19 | CORS type definitions |
| `@types/supertest` | ^6.0.0 | 6.0.3 | Supertest type definitions |

### 9.4 Web workspace (`@livepulse/web`, version 0.0.0)

Runtime dependencies:

| Package | Declared | Installed | Used for |
| --- | --- | --- | --- |
| `next` | ^15.5.28 | 15.5.28 | Web framework (App Router) |
| `react` | ^19.3.1 | 19.3.1 | UI |
| `react-dom` | ^19.3.1 | 19.3.1 | UI rendering |
| `socket.io-client` | ^4.8.4 | 4.8.4 | Browser realtime connection |
| `zod` | ^3.23.8 | 3.25.76 (root install) | Shared validation rules in the browser |
| `tailwindcss` | ^4.3.3 | 4.3.3 | Styling |
| `@tailwindcss/postcss` | ^4.3.3 | 4.3.3 | Tailwind build step |
| `postcss` | ^8.5.31 | 8.5.31 | CSS build |
| `uqr` | 0.1.3 (exact) | 0.1.3 | QR code for the join link (`web/src/components/ui/QrCode.tsx`) |
| `@livepulse/shared` | `*` (workspace) | workspace | Shared schemas and contracts |

Development dependencies:

| Package | Declared | Installed | Used for |
| --- | --- | --- | --- |
| `vitest` | ^2.1.9 | 2.1.9 | Test runner |
| `jsdom` | ^30.1.3 | 30.1.3 | Browser-like test environment |
| `@testing-library/react` | ^16.3.3 | 16.3.3 | Component tests |
| `@playwright/test` | 1.64.0 (exact) | 1.64.0 | End-to-end tests (`web/playwright.config.ts`, `web/e2e/`) |
| `@types/react` | ^19.3.0 | 19.3.0 | React type definitions |
| `@types/react-dom` | ^19.3.0 | 19.3.0 | React DOM type definitions |
| `typescript` | ^5.9.3 | 5.9.3 | Compiler |

### 9.5 Shared workspace (`@livepulse/shared`, version 0.0.0)

| Package | Declared | Installed | Used for |
| --- | --- | --- | --- |
| `zod` | ^3.23.8 | 3.25.76 (root install) | Schemas and contracts |
| `vitest` | ^2.1.0 | 2.1.9 | Tests |
| `typescript` | ^5.6.0 | 5.9.3 | Compiler |
| `@types/node` | ^20.0.0 | 20.19.43 | Node type definitions |

Installed versions are the ones in `node_modules` on the machine where this file was written. The `package.json` files and
`package-lock.json` (the lockfile, now listed in `.gitignore`) are the source of truth; check them when versions change.

---

## 10. Safe-practice checklist

- [ ] `.env` exists locally and is not committed (`git status` must not list it).
- [ ] `POSTGRES_PASSWORD` and the password in `DATABASE_URL` are the same, and are not a default value outside local use.
- [ ] `TEST_DATABASE_URL` points to a database whose name ends in `_test`.
- [ ] `ANTHROPIC_API_KEY` is set only when `AI_PROVIDER=anthropic`, and is not written in any committed file.
- [ ] `OPERATOR_KEY` is at least 32 random characters, or left unset (the operator route then answers 503).
- [ ] `TRUST_PROXY=true` only when a reverse proxy sits in front of the API.
- [ ] `NEXT_PUBLIC_API_URL` contains no secret.

---

## 11. Verifying and troubleshooting

### 11.1 Verify the API starts

1. Start the containers: `docker compose up -d`.
2. Apply migrations: `npm run db:migrate`.
3. Start the API: `npm run dev:api`.
4. Check the endpoints:
   - `http://localhost:4000/health` returns 200 while the process runs.
   - `http://localhost:4000/ready` returns 200 when PostgreSQL and Redis respond, 503 otherwise, and `degraded` when Redis is down.

### 11.2 Common startup errors

| Message (exact text in the code) | Cause | Fix |
| --- | --- | --- |
| `Invalid environment configuration: <NAME>` | The named setting is missing or outside its allowed range. The value is never printed | Check the setting in sections 3 to 5, correct it in `.env`, restart |
| `Invalid environment configuration: ANTHROPIC_API_KEY` | `AI_PROVIDER=anthropic` but no key is set (cross-field rule) | Set `ANTHROPIC_API_KEY`, or set `AI_PROVIDER=fake` |
| `Invalid environment configuration: EMBEDDINGS_DIM` | `EMBEDDINGS_DIM` is not `384` | Remove the setting or set it to `384` |
| `NEXT_PUBLIC_API_URL must be a http(s) URL without a trailing slash, e.g. http://localhost:4000` | The web URL is missing (in production), has a trailing slash, or does not start with `http://` or `https://` | Correct `web/.env.local` and restart the web app |
| Connection refused on port 5432 or 6379 | PostgreSQL or Redis is not running, or another local service uses the port | Run `docker compose up -d`, or stop the other service, or change the host port and the URL to match |
| API refuses to start, Redis unreachable | `REDIS_URL` is wrong, or Redis is not running | Check `REDIS_URL` and that the Redis container is healthy |
| Integration tests refuse to run | `TEST_DATABASE_URL` is missing or its database name does not end in `_test` | Point it to a database such as `livepulse_test` |

### 11.3 Notes on the test database

The integration suite is meant for a separate database. Its own setting comment says it refuses any database whose name does
not end in `_test` (`api/src/config/env.ts`). Keep `TEST_DATABASE_URL` pointed at a `_test` database, and keep the demo
database in `DATABASE_URL`. Do not rename a database to get past this check.

---

## 12. Changing configuration

| Change | What else to do |
| --- | --- |
| Port, log level, presence, socket limits, AI limits, budget, thresholds | Restart the API. No migration |
| `DATABASE_URL`, `REDIS_URL` | Restart the API. Check that the database and Redis are running |
| `WEB_ORIGIN` | Restart the API. The browser origin must match exactly |
| `EMBEDDINGS_DIM` or the embedding model | Needs a database migration and re-embedding of all passages. Do not change on a database that holds data without a plan |
| `AI_PROVIDER` to `anthropic` | Set `ANTHROPIC_API_KEY` first, or the API will not start |
| `POSTGRES_*` | Applies when the database container is first created. Changing it later needs a new volume or a manual change inside PostgreSQL |
| `NEXT_PUBLIC_API_URL` | Restart the web app. The value is built into the browser code |
| Package versions (section 9) | Change only through `package.json`, after the team approves the change. Installs still write `package-lock.json` locally |
