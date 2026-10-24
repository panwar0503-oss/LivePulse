import type { ClientToServerEvents, ServerToClientEvents } from '@livepulse/shared'
import { handshakeAuthSchema } from '@livepulse/shared'
import type { Logger } from 'pino'
import type { Server, Socket } from 'socket.io'
import type { Env } from '../config/env.js'
import { describeError } from '../db/redis.js'
import { parseCookies, participantCookieName, presenterCookieName } from '../lib/cookies.js'
import { hashToken, safeEqualHash } from '../lib/tokens.js'
import type { SessionModels } from '../services/sessions.service.js'

export type SocketData = {
  role: 'presenter' | 'participant'
  sessionId: string
  participantId: string | null
}

// No server-to-server events: cross-instance traffic is the adapter's broadcasts and fetchSockets only.
export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>
export type RealtimeSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

export const sessionRoom = (sessionId: string): string => `session:${sessionId}`
export const presenterRoom = (sessionId: string): string => `presenter:${sessionId}`

export type RefusalCode = 'FORBIDDEN_ORIGIN' | 'TOO_MANY_CONNECTIONS' | 'UNAUTHORIZED'

// Generic on purpose: unknown session, bad cookie and wrong session must be indistinguishable.
const REFUSAL_MESSAGES: Record<RefusalCode, string> = {
  FORBIDDEN_ORIGIN: 'This connection came from an origin that is not allowed.',
  TOO_MANY_CONNECTIONS: 'Too many connections. Please try again later.',
  UNAUTHORIZED: 'Could not connect to this session.',
}

type RefusalError = Error & { data: { code: RefusalCode; message: string } }

const refuse = (code: RefusalCode): RefusalError =>
  Object.assign(new Error(code), { data: { code, message: REFUSAL_MESSAGES[code] } })

export type SocketAuthDeps = {
  env: Pick<Env, 'WEB_ORIGIN' | 'TRUST_PROXY' | 'SOCKET_MAX_PER_IP' | 'SOCKET_MAX_PER_SESSION'>
  models: SessionModels
  logger: Logger
}

export type SocketAuth = {
  middleware: (socket: RealtimeSocket, next: (err?: Error) => void) => void
  /** Call from io.on('connection'): counts the socket against its address until it disconnects. */
  trackConnection: (socket: RealtimeSocket) => void
}

const firstHeader = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value

// Same rule as Express with `trust proxy: true`: the left-most X-Forwarded-For entry, only behind a proxy.
const clientAddress = (socket: RealtimeSocket, trustProxy: boolean): string => {
  if (trustProxy) {
    const forwarded = firstHeader(socket.handshake.headers['x-forwarded-for'])?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  return socket.handshake.address
}

type Identity = Pick<SocketData, 'sessionId' | 'participantId'>

export const createSocketAuth = (io: RealtimeServer, deps: SocketAuthDeps): SocketAuth => {
  const { env, models, logger } = deps
  // Counted on connection and released on disconnect, which always pair up. Handshakes in flight are not
  // counted, so a burst of simultaneous handshakes can briefly exceed the cap (accepted for a prototype).
  const openPerAddress = new Map<string, number>()

  const resolveIdentity = async (
    auth: unknown,
    cookies: Record<string, string>,
  ): Promise<Identity | null> => {
    const parsed = handshakeAuthSchema.safeParse(auth)
    if (!parsed.success) return null

    if (parsed.data.role === 'presenter') {
      const session = await models.Session.findByPk(parsed.data.sessionId, {
        attributes: ['id', 'presenterKeyHash'],
      })
      if (!session) return null
      const key = cookies[presenterCookieName(session.id)]
      if (!key || !safeEqualHash(hashToken(key), session.presenterKeyHash)) return null
      return { sessionId: session.id, participantId: null }
    }

    // room_code is unique-indexed; a plain read (no lock) is enough because no state changes here.
    const session = await models.Session.findOne({
      where: { roomCode: parsed.data.roomCode },
      attributes: ['id'],
    })
    if (!session) return null
    const token = cookies[participantCookieName(session.id)]
    if (!token) return null
    const participant = await models.Participant.findOne({
      where: { tokenHash: hashToken(token) },
      attributes: ['id', 'sessionId'],
    })
    if (participant?.sessionId !== session.id) return null
    return { sessionId: session.id, participantId: participant.id }
  }

  const authenticate = async (socket: RealtimeSocket): Promise<RefusalCode | null> => {
    // Browsers always send Origin on websocket upgrades; a missing one is not a browser on our site.
    // Stricter than HTTP on purpose: cookie-authenticated sockets are open to cross-site hijacking.
    const origin = firstHeader(socket.handshake.headers.origin)
    if (origin === undefined || !env.WEB_ORIGIN.includes(origin)) return 'FORBIDDEN_ORIGIN'

    const address = clientAddress(socket, env.TRUST_PROXY)
    if ((openPerAddress.get(address) ?? 0) >= env.SOCKET_MAX_PER_IP) return 'TOO_MANY_CONNECTIONS'

    const identity = await resolveIdentity(
      socket.handshake.auth,
      parseCookies(socket.handshake.headers.cookie),
    )
    if (!identity) return 'UNAUTHORIZED'

    const room = sessionRoom(identity.sessionId)
    // Rooms include sockets on this instance only; the cap is per instance by design.
    if ((io.of('/').adapter.rooms.get(room)?.size ?? 0) >= env.SOCKET_MAX_PER_SESSION) {
      return 'TOO_MANY_CONNECTIONS'
    }

    const role = identity.participantId === null ? 'presenter' : 'participant'
    socket.data = { role, sessionId: identity.sessionId, participantId: identity.participantId }
    // Joined before CONNECT, so a client that refetches on 'connect' cannot miss an event in between.
    // Rooms come only from the verified cookie, never from client input.
    const rooms = role === 'presenter' ? [room, presenterRoom(identity.sessionId)] : [room]
    await socket.join(rooms)
    return null
  }

  return {
    middleware: (socket, next) => {
      authenticate(socket)
        .then((code) => next(code ? refuse(code) : undefined))
        .catch((err: unknown) => {
          // Never log handshake headers or auth: they carry cookies.
          logger.error({ realtimeError: describeError(err) }, 'socket handshake failed')
          next(refuse('UNAUTHORIZED'))
        })
    },
    trackConnection: (socket) => {
      const address = clientAddress(socket, env.TRUST_PROXY)
      openPerAddress.set(address, (openPerAddress.get(address) ?? 0) + 1)
      socket.once('disconnect', () => {
        const remaining = (openPerAddress.get(address) ?? 1) - 1
        if (remaining > 0) openPerAddress.set(address, remaining)
        else openPerAddress.delete(address)
      })
    },
  }
}
