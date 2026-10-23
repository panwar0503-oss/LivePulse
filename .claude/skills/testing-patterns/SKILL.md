---
name: testing-patterns
description: LivePulse Vitest patterns - business-language test names, service unit tests, Supertest API integration, Socket.IO integration, concurrency tests, React component tests. Use when writing tests.
---

# Testing patterns (Vitest + Supertest + socket.io-client)

**Names speak business language:** `it('rejects a second vote from the same participant')`, not
`it('throws ConflictError when create fails')`.

## Where
- Unit: colocated `*.test.ts(x)`.
- API integration: `api/tests/integration/*.test.ts` against a dedicated test DB (env-configured).
- Socket: `api/tests/realtime/*.test.ts`.

## API integration (Supertest)
```ts
describe('Voting on a poll', () => {
  it('records a participant vote and returns updated results', async () => {
    const { app, host, participant } = await setupSessionWithOpenPoll()
    const res = await request(app).post(`/api/polls/${poll.id}/votes`).set(authHeader(participant)).send({ optionId })
    expect(res.status).toBe(201)
    expect(res.body.options.find((o) => o.id === optionId).votes).toBe(1)
  })
  it('rejects voting on a closed poll', async () => { /* … expect 409 + error.code 'POLL_CLOSED' */ })
  it('does not let a participant from another session vote', async () => { /* … expect 403/404 */ })
})
```

## Concurrency
```ts
it('counts only one vote when the same participant submits twice at once', async () => {
  const results = await Promise.allSettled([vote(p, poll.id, a), vote(p, poll.id, a)])
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  expect(await Vote.count({ where: { pollId: poll.id } })).toBe(1)
})
```

## Socket integration
```ts
let io: Server, url: string
beforeAll(async () => { ({ io, url } = await startTestServer()) })        // ephemeral port
afterAll(async () => { io.close(); await closeDbAndRedis() })
it('only delivers poll updates to members of the session room', async () => {
  const member = await connectAs(participantA, url); const outsider = await connectAs(participantOther, url)
  await joinSession(member, session.id)
  const received = onceEvent(member, 'poll:results-updated')
  const notReceived = expectNoEvent(outsider, 'poll:results-updated', 300)
  await voteViaApi(participantA, poll.id, optionId)
  await expect(received).resolves.toMatchObject({ id: poll.id })
  await notReceived
  member.disconnect(); outsider.disconnect()
})
```
Also: rejected handshake without auth, invalid payload → ack `{ ok: false }`, unauthorized join.

## React components
Test behaviour the user sees (Testing Library): loading → data, error with retry, empty state, form validation
messages, disabled submit while pending. Query by role/label, not class names.

## Data & isolation
Factories for sessions/polls/participants; each test creates its own data and cleans up (transaction rollback or
truncate the **test** DB only). Fake timers for time-based rules; no sleeps.

## Running
Use real script names from `package.json`; e.g. `npx vitest run <file> --reporter=dot` for the narrowest run.
