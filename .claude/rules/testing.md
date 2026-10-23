---
paths:
  - "**/*.test.{ts,tsx}"
  - "**/*.spec.{ts,tsx}"
  - "**/tests/**"
  - "**/vitest.config.*"
  - "**/vitest.workspace.*"
---

# Testing

- Layout (proposed): unit tests colocated `*.test.ts`; API integration (Supertest + real Postgres) in
  `api/tests/integration/`; socket tests in `api/tests/realtime/`. E2E only for critical journeys once a
  tool is approved.
- Assert behaviour, not implementation. Cover 400/401/403/404/409 and closed/expired states.
- Concurrency: e.g. two simultaneous votes by one participant store exactly one vote; a vote racing poll close.
- Bug fixes: failing regression test first, confirm it fails for the right reason, then fix.
- Independent tests; each cleans up its own data. Integration tests only against a dedicated **test** database
  (env-configured); refuse destructive setup against anything else.
- Fake timers, no sleeps. Close servers, sockets, DB and Redis in `afterAll`. Prefer real Postgres/Redis over
  mocking Sequelize; mock only external boundaries.
- Never delete, `.skip`/`.only`, or loosen assertions to get green. Report exact commands and real counts.
