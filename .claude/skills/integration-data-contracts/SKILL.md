---
name: integration-data-contracts
description: Keep LivePulse data shapes consistent from PostgreSQL to Sequelize, API responses, shared Zod schemas, socket events, and Next.js. Use when adding fields or wiring layers.
---

# Integration data contracts

## Naming chain (one field, every layer)
| Layer | Example |
|---|---|
| PostgreSQL column | `closed_at` (snake_case) |
| Sequelize attribute (`underscored: true`) | `closedAt` |
| API JSON / shared schema / socket payload | `closedAt` (camelCase, ISO-8601 string for dates) |
| Web type | `z.infer<typeof PollSchema>['closedAt']` — never hand-written duplicates |

IDs are UUID strings. Dates cross the wire as ISO strings; convert to `Date` only where needed in the UI.

## Single source of truth: `shared/`
```ts
// shared/src/schemas/poll.ts
export const PollOptionSchema = z.object({ id: z.string().uuid(), label: z.string().min(1).max(80), votes: z.number().int().nonnegative() })
export const PollSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  question: z.string().min(1).max(200),
  status: z.enum(['draft', 'open', 'closed']),
  options: z.array(PollOptionSchema).min(2).max(10),
  version: z.number().int(),
  closedAt: z.string().datetime().nullable(),
})
export type Poll = z.infer<typeof PollSchema>
export const CreatePollInput = PollSchema.pick({ question: true }).extend({ options: z.array(z.string().min(1).max(80)).min(2).max(10) })
```
API validates **input** with these schemas; web uses the same types (and may parse responses at boundaries).

## Response envelope
- Success: the resource or `{ items, nextCursor }` for lists — keep it consistent across endpoints.
- Error: `{ "error": { "code": "POLL_CLOSED", "message": "…", "details"?: … } }`, same codes in socket acks.

## Mapping rules
- Services return DTOs built explicitly (`toPollDto(model)`), never raw Sequelize instances.
- Never expose internal/private columns (participant identity behind votes, tokens, emails) unless the requirement says so.
- Socket broadcast payloads reuse the same DTO shape plus `version`.

## Adding a field — checklist
1. Migration (+ `down`) → 2. Model attribute → 3. Shared schema → 4. DTO mapper → 5. Validation for input →
6. Socket payload if broadcast → 7. Web usage → 8. Tests at each touched layer → 9. Requirement data notes.
