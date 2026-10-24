import { io, type Socket } from 'socket.io-client'
import type { ClientToServerEvents, HandshakeAuth, ServerToClientEvents } from '@livepulse/shared'
import { apiBaseUrl } from '../lib/config'

export type SessionSocket = Socket<ServerToClientEvents, ClientToServerEvents>

// Path is under /api so the Path=/api session cookies are sent; websocket-only because polling across
// instances would need sticky sessions.
export const createSessionSocket = (auth: HandshakeAuth): SessionSocket =>
  io(apiBaseUrl, {
    path: '/api/socket.io',
    transports: ['websocket'],
    withCredentials: true,
    auth,
    autoConnect: true,
    reconnection: true,
    reconnectionDelayMax: 5000,
  })
