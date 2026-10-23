---
name: realtime-patterns
description: LivePulse Socket.IO + Redis adapter patterns - typed events, handshake auth, room join authorization, ack handling, emit after commit, client reconnect and versioning. Use for realtime code.
---

# Realtime patterns (Socket.IO + Redis adapter)

## Typed contracts (`shared/src/events/`)
```ts
export type Ack<T> = (res: { ok: true; data: T } | { ok: false; error: { code: string; message: string } }) => void
export interface ClientToServerEvents {
  'session:join': (p: { sessionId: string }, ack: Ack<{ snapshotVersion: number }>) => void
  'poll:vote': (p: { pollId: string; optionId: string; requestId: string }, ack: Ack<{ version: number }>) => void
}
export interface ServerToClientEvents {
  'poll:results-updated': (p: Poll) => void   // Poll from shared schemas, includes version
  'poll:closed': (p: { pollId: string; version: number }) => void
}
export const JoinPayload = z.object({ sessionId: z.string().uuid() })
```

## Server setup
```ts
const io = new Server<ClientToServerEvents, ServerToClientEvents, {}, SocketData>(httpServer, { cors: { origin: env.WEB_ORIGIN, credentials: true } })
const pub = createClient({ url: env.REDIS_URL }); const sub = pub.duplicate()
await Promise.all([pub.connect(), sub.connect()])
io.adapter(createAdapter(pub, sub))
pub.on('error', (e) => logger.error({ err: e }, 'redis pub error'))

io.use(async (socket, next) => {
  const user = await authenticateSocket(socket.handshake)   // cookie/token → user or null
  if (!user) return next(new Error('UNAUTHORIZED'))
  socket.data.user = user
  next()
})
```

## Handler with validation + authorization
```ts
socket.on('session:join', async (payload, ack) => {
  const parsed = JoinPayload.safeParse(payload)
  if (!parsed.success) return ack({ ok: false, error: { code: 'VALIDATION', message: 'Invalid payload' } })
  try {
    const membership = await sessionService.assertCanJoin(socket.data.user, parsed.data.sessionId)
    await socket.join(`session:${parsed.data.sessionId}`)
    if (membership.isHost) await socket.join(`session:${parsed.data.sessionId}:host`)
    ack({ ok: true, data: { snapshotVersion: membership.version } })
  } catch (e) { ack(toAckError(e)) }
})
```
Every mutating event: validate → authorize → call the **same service** the HTTP route uses → ack.

## Emit after commit
Services emit only after the transaction resolves (or via `t.afterCommit`). Broadcast to the session room; send
host-only data to `session:<id>:host`. Never include data recipients may not see.

## Client (`web/src/realtime/`)
- One socket per tab in a provider; `withCredentials: true`; typed with the shared maps.
- On `connect` (including reconnects): emit `session:join`, then fetch the HTTP snapshot.
- Keep `version` per entity; ignore incoming payloads with `version <= current`.
- Mutations send a `requestId` so retries after reconnect are idempotent server-side.
- Show connection status (connected / reconnecting) accessibly.

## Scaling notes
Redis adapter fans out across instances; it does not persist. Throttle high-frequency broadcasts (e.g. coalesce
vote counts every ~250 ms per poll).
