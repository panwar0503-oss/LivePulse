---
paths:
  - "api/src/**/*.ts"
---

# Backend API (Express)

- Layers: route (wiring) → `validate({ params, query, body })` Zod middleware → controller (HTTP only) →
  service (business rules, authorization on loaded records, transactions; no `req`/`res`) → model.
- Authorization: auth middleware sets typed `req.user`; services check ownership on the loaded record
  (e.g. `session.hostId === user.id`), never an id from the request body. Prefer 404 over 403 if existence leaks.
- Errors: services throw typed app errors; one error middleware returns
  `{ "error": { "code", "message", "details?" } }`. 400 validation (field details), 401, 403, 404,
  409 conflict/unique violation, 500 generic (log full error with request id; no stack traces to clients).
- Async errors must reach the error middleware (check the installed Express version: 5 handles rejected promises).
- Body size limits; rate-limit join/vote/create endpoints; paginate lists; return explicit DTOs, never raw models.
