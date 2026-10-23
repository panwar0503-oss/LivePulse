---
paths:
  - "api/src/models/**"
  - "api/src/db/**"
  - "api/migrations/**"
  - "api/seeders/**"
  - "api/.sequelizerc"
---

# Sequelize + PostgreSQL

**Models:** typed `Model<InferAttributes<…>, InferCreationAttributes<…>>`; explicit `DataTypes`, `allowNull`,
defaults; `underscored: true`, timestamps; UUID PKs unless the plan says otherwise; associations registered in one
place; deliberate `onDelete`/`onUpdate` on every FK.

**Migrations:** one per logical change, working `up` and `down`, transactional when multi-step; must match models.
Never edit an applied/shared migration; add a new one. Destructive changes use expand → backfill → contract and
are flagged to the user. Index FKs and hot filters; unique indexes for invariants (e.g. `votes(poll_id, participant_id)`).
Never run `db:drop`, `db:migrate:undo:all`, `sync({ force })`, or resets without approval.

**Transactions & concurrency:** `sequelize.transaction(async (t) => …)` and pass `{ transaction: t }` to every
query (a missing option silently escapes the transaction). Enforce invariants with constraints and map
`UniqueConstraintError` → 409, not check-then-insert. `lock: t.LOCK.UPDATE` when a decision depends on row state
(e.g. poll open while voting). Prefer atomic `increment`. Emit events after commit (`t.afterCommit`).

**Queries:** avoid N+1 (`include` with explicit `attributes`); `sequelize.query` only with `replacements`/`bind`.
