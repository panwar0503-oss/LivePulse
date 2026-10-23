---
paths:
  - "{api,web}/**/*.{ts,tsx}"
  - "shared/**/*.ts"
---

# General coding (TypeScript)

- `strict` TS. `unknown` + Zod/type guards for untrusted data; `any` only with a justifying comment.
- Naming: `camelCase` vars/functions, `PascalCase` types/classes/components/models, `kebab-case` files
  (components may be `PascalCase.tsx`), `snake_case` DB columns via Sequelize `underscored: true`.
- Explicit return types on exports. No `!` assertions without an obvious invariant. Discriminated unions for state.
- No floating promises. Never swallow errors (`catch {}`); handle, or rethrow with `{ cause }`.
- Logging: structured logger with request id (library chosen in Phase 2). No `console.log` in committed code.
  Never log secrets, tokens, or personal data.
- Shared api/web types and schemas go in `shared/`. No speculative abstractions; remove dead/debug code.
- Comments explain *why*. Match the surrounding style.
