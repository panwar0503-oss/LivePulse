---
paths:
  - "api/**/*.ts"
  - "shared/**/*.ts"
  - "**/package.json"
  - "**/.env.example"
  - "**/docker-compose*.yml"
  - "**/Dockerfile*"
---

# Security

- Zod on all untrusted input with size bounds (strings, arrays, options per poll, body size).
- Server-side authorization on every mutation and socket event; check cross-session and cross-user access.
- Votes: DB unique constraint + 409; poll-open check inside the same transaction.
- Join codes unguessable enough and rate-limited. Cookies `HttpOnly`/`Secure`/`SameSite`; CSRF where relevant;
  CORS with explicit origins (no `*` with credentials).
- No `dangerouslySetInnerHTML` with user content. Responses use DTOs, never hashes, tokens, or others' data.
- Env validated with Zod at startup (fail fast). `.env.example` placeholders only. Never log secrets or bodies.
- Dependencies: ask first; prefer maintained packages; review lockfile diffs; `npm audit` when deps change.
