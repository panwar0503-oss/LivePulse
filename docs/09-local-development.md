# 09 — Local Development and Troubleshooting

## Prerequisites
Node.js LTS + npm · Docker Desktop (Compose) · Git. Optional: Anthropic API key (only for real AI; the `fake`
provider works offline) · Claude Desktop (MCP demo).

```bash
node --version && npm --version && docker compose version && git --version
```

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
REDIS_URL=redis://localhost:6379
REDIS_REQUIRED=true
LOG_LEVEL=debug

# AI (Phase 9+)
AI_ENABLED=true
AI_PROVIDER=fake                 # fake | anthropic
ANTHROPIC_API_KEY=               # only when AI_PROVIDER=anthropic; never commit
AI_MODEL=claude-opus-5-5
AI_FAST_MODEL=                   # optional; decided in Phase 9
EMBEDDINGS_PROVIDER=local        # local | fake
EMBEDDINGS_MODEL=Xenova/all-MiniLM-L6-v2
AI_SESSION_TOKEN_BUDGET=200000
AI_MAX_CONCURRENCY=2
AI_MAX_ATTEMPTS=3
AI_INSIGHTS_INTERVAL_SECONDS=15
RAG_MIN_SIMILARITY=0.35
KNOWLEDGE_MAX_UPLOAD_MB=10

# MCP (Phase 15) — set in the Claude Desktop MCP config, not here
# LIVEPULSE_API_URL=http://localhost:4000
# LIVEPULSE_PRESENTER_KEY=
```
Env is validated with Zod at startup; missing/invalid values fail fast with a clear message (no secret values
printed). `ANTHROPIC_API_KEY` is required only when `AI_PROVIDER=anthropic`.

## Scripts
None exist yet. Phase 2 defines them; read root and workspace `package.json` before running anything. Expected
shape (illustrative): `dev`, `build`, `lint`, `test`, `db:migrate`, `db:migrate:undo`, `db:seed:demo`, and later
`dev:api:second` (second instance), `mcp` (MCP server), `eval:ai` (opt-in real-model eval).

## Startup workflow (after Phase 2)
1. `cp .env.example .env` and set local values.
2. `docker compose up -d`
3. `npm install`
4. `npm run db:migrate -w api`
5. `npm run dev`
6. Open `http://localhost:3000`; check `http://localhost:4000/health` and `/ready`.

The first `local` embeddings call downloads the model (~tens of MB) and caches it; run it once before an offline
demo.

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
