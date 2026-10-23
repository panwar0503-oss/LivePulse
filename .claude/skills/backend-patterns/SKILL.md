---
name: backend-patterns
description: LivePulse Express + Sequelize code patterns - route, validation middleware, controller, service with transaction, model, migration, error handling. Use when writing api/ code.
---

# Backend patterns (Express + TypeScript + Sequelize)

Patterns, not scaffolding. Match the installed versions and existing code; read a sibling file before writing.

## Request flow
`route → authenticate → validate(Zod) → controller → service (authz + transaction) → model → DTO`

## Validation middleware
```ts
// api/src/middleware/validate.ts
export const validate = (schemas: { params?: ZodTypeAny; query?: ZodTypeAny; body?: ZodTypeAny }) =>
  (req: Request, _res: Response, next: NextFunction) => {
    const parsed = z.object({ params: schemas.params ?? z.any(), query: schemas.query ?? z.any(), body: schemas.body ?? z.any() })
      .safeParse({ params: req.params, query: req.query, body: req.body })
    if (!parsed.success) return next(new ValidationError(parsed.error.flatten()))
    res.locals.input = parsed.data
    next()
  }
```

## Route + controller (HTTP only)
```ts
router.post('/sessions/:sessionId/polls', authenticate, validate({ params: SessionParams, body: CreatePollInput }), pollController.create)

export const create: RequestHandler = async (req, res) => {
  const { params, body } = res.locals.input
  const poll = await pollService.create(req.user, params.sessionId, body)
  res.status(201).json(poll)
}
```
(Express 5 forwards rejected promises to the error middleware; on Express 4 wrap handlers.)

## Service (rules, authz, transaction)
```ts
export async function vote(user: AuthUser, pollId: string, optionId: string) {
  const result = await sequelize.transaction(async (t) => {
    const poll = await Poll.findByPk(pollId, { transaction: t, lock: t.LOCK.UPDATE })
    if (!poll) throw new NotFoundError('POLL_NOT_FOUND')
    await assertParticipant(user, poll.sessionId, t)
    if (poll.status !== 'open') throw new ConflictError('POLL_CLOSED')
    try {
      await Vote.create({ pollId, optionId, participantId: user.id }, { transaction: t })
    } catch (e) {
      if (e instanceof UniqueConstraintError) throw new ConflictError('ALREADY_VOTED')
      throw e
    }
    await PollOption.increment('votes', { where: { id: optionId, pollId }, transaction: t })
    await poll.increment('version', { transaction: t })
    return toPollDto(await poll.reload({ include: [PollOption], transaction: t }))
  })
  emitPollUpdated(result) // after commit
  return result
}
```

## Errors
```ts
export class AppError extends Error { constructor(public status: number, public code: string, message = code, public details?: unknown) { super(message) } }
export class NotFoundError extends AppError { constructor(code = 'NOT_FOUND') { super(404, code) } }
// ValidationError 400, UnauthorizedError 401, ForbiddenError 403, ConflictError 409
// error middleware: AppError → { error: { code, message, details } }; anything else → log + 500 { code: 'INTERNAL' }
```

## Model
```ts
export class Poll extends Model<InferAttributes<Poll>, InferCreationAttributes<Poll>> {
  declare id: CreationOptional<string>
  declare sessionId: string
  declare question: string
  declare status: CreationOptional<'draft' | 'open' | 'closed'>
  declare version: CreationOptional<number>
}
Poll.init({ id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true }, /* … */ },
  { sequelize, tableName: 'polls', underscored: true })
```

## Migration
Create via the CLI script (e.g. `npx sequelize-cli migration:generate --name create-votes` once configured).
```js
up: async (q, S) => q.sequelize.transaction(async (transaction) => {
  await q.createTable('votes', { id: { type: S.UUID, primaryKey: true }, poll_id: { type: S.UUID, allowNull: false, references: { model: 'polls', key: 'id' }, onDelete: 'CASCADE' }, /* … */ }, { transaction })
  await q.addIndex('votes', ['poll_id', 'participant_id'], { unique: true, transaction })
}),
down: async (q) => q.dropTable('votes'),
```

## Config
Env parsed once with Zod in `api/src/config/env.ts`; fail fast on missing values; no `process.env` elsewhere.
