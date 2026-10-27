# 09 — Local Development and Troubleshooting

## Prerequisites

Node.js LTS + npm · Docker Desktop (Compose) · Git. Optional: Anthropic API key (only for real AI; the `fake`
provider works offline) · Claude Desktop (MCP demo).

```bash
node --version && npm --version && docker compose version && git --version
```

Node version: the PDF library `unpdf` needs Node 22.18 or later. The root `package.json` `engines` field still says
`>=20`. Open item: decide whether to raise `engines` to match; it is not changed in this phase.

## Docker Compose services (Phase 2)

- `postgres`: image `pgvector/pgvector:pg16` (PostgreSQL with pgvector), named volume, health check.
- `redis`: `redis:7`, health check.
- Development-only credentials from `.env` or documented local defaults; never reused in public deployments.

## Environment (`.env.example`, placeholders only)

```dotenv
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
DATABASE_URL=postgres://livepulse:change_me@localhost:5432/livepulse
TEST_DATABASE_URL=postgres://livepulse:change_me@localhost:5432/livepulse_test  # integration tests only
REDIS_URL=redis://localhost:6379
REDIS_REQUIRED=true
LOG_LEVEL=debug
TRUST_PROXY=false                # true only behind a reverse proxy (affects req.ip)

# AI (Phase 9+)
AI_ENABLED=true
AI_PROVIDER=fake                 # fake | anthropic
ANTHROPIC_API_KEY=               # only when AI_PROVIDER=anthropic; never commit
AI_MODEL=claude-opus-5-5
AI_FAST_MODEL=                   # optional; decided in Phase 9
EMBEDDINGS_PROVIDER=fake         # local | fake (fake is the default; set local to use the model)
EMBEDDINGS_MODEL=Xenova/all-MiniLM-L6-v2
AI_SESSION_TOKEN_BUDGET=200000
AI_MAX_CONCURRENCY=2
AI_MAX_ATTEMPTS=3
RERANKER_PROVIDER=fake           # fake | local (knowledge search; fake is the default)
RERANKER_MODEL=Xenova/ms-marco-MiniLM-L-6-v2  # used when RERANKER_PROVIDER=local
OPERATOR_KEY=                    # optional; at least 32 characters; enables PATCH /api/ops/ai

# MCP (Phase 15) — set in the Claude Desktop or Claude Code MCP config, not here. Setup: docs/guides/mcp-claude-desktop-setup.md
# LIVEPULSE_API_URL=http://localhost:4000
# LIVEPULSE_SESSION_ID=<your-session-id>
# LIVEPULSE_PRESENTER_KEY=<your-presenter-key>
```

Env is validated with Zod at startup; missing/invalid values fail fast with a clear message (no secret values
printed). `ANTHROPIC_API_KEY` is required only when `AI_PROVIDER=anthropic`.

Local embeddings cache: the first use of `EMBEDDINGS_PROVIDER=local` downloads `Xenova/all-MiniLM-L6-v2` (about 23 MB)
into `api/.cache/models`. That folder is git-ignored. Later runs work offline.

Reranker cache: the first use of `RERANKER_PROVIDER=local` downloads `Xenova/ms-marco-MiniLM-L-6-v2` (about 23 MB,
quantized) once into the same `api/.cache/models` folder. If the reranker fails, knowledge search still returns results in
fusion order with `reranked: false`. The minimum score is a constant per reranker (see `02-architecture.md`), not an
env setting; the upload limit is a constant too (10 MB per file, 20 per session).

## Scripts

None exist yet. Phase 2 defines them; read root and workspace `package.json` before running anything. Expected
shape (illustrative): `dev`, `build`, `lint`, `test`, `db:migrate`, `db:migrate:undo`, `db:seed:demo`, and later
`dev:api:second` (second instance), `mcp` (MCP server), `eval:ai` (opt-in real-model eval).

## Startup workflow (after Phase 2)

1. `cp .env.example .env` and set local values.
2. `docker compose up -d`
3. `npm install`
4. `npm run db:migrate -w api` (once per dev database; the API cannot serve sessions until it has run)
5. Start the API and the web app in two terminals: `npm run dev:api` and `npm run dev:web`
6. Open `http://localhost:3000`; check `http://localhost:4000/health` and `/ready`.

The first `local` embeddings call downloads the model (~tens of MB) and caches it; run it once before an offline
demo.

## Test database

Integration tests use their own database and never `DATABASE_URL`.

1. Create it once: `docker compose exec postgres psql -U livepulse -d livepulse -c "CREATE DATABASE livepulse_test;"`
2. Set `TEST_DATABASE_URL` in `.env` (see `.env.example`). The name must end in `_test`.
3. `npm test -w api` runs the fast unit tests (no database). `npm run test:integration -w api` migrates and
   runs against the test database only; it refuses to start unless `NODE_ENV=test` and the name ends in `_test`.

## Troubleshooting

- **PostgreSQL refused / `type "vector" does not exist`** — check `docker compose ps`, `DATABASE_URL`, and that the
  image is `pgvector/pgvector`; run migrations (they create the extension).
- **Redis refused** — container status, `REDIS_URL`, backend logs for pub/sub connection errors.
- **CORS / socket fails** — `WEB_ORIGIN`, ports, transport settings, proxy WebSocket upgrade.
- **Migration fails** — read the error, check order; never fix by dropping data without approval; test on a clean
  disposable DB.
- **Stale live data** — commit before emit? correct room? Redis adapter status? client re-fetches on reconnect?
- **AI jobs stuck PENDING** — `AI_ENABLED`, runner logs, budget exhausted, `GET /api/ai/jobs/:id`.
- **Anthropic 400 errors** — sampling params or forced `tool_choice` being sent by a helper (see `10` §2 risks);
  wrong model ID.
- **Embeddings slow on first call** — model download/warm-up; warm it at startup in dev.
- **Port in use** — stop the process or change the port in `.env`.
