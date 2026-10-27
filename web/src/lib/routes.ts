// The one place that builds internal paths. Change a route here, not in every link.
export const routes = {
  home: () => '/',
  host: () => '/host',
  hostRoom: (sessionId: string) => `/host/${encodeURIComponent(sessionId)}`,
  hostKnowledge: (sessionId: string) => `${routes.hostRoom(sessionId)}/knowledge`,
  hostReport: (sessionId: string) => `${routes.hostRoom(sessionId)}/report`,
  join: (roomCode?: string) => (roomCode ? `/join?code=${encodeURIComponent(roomCode)}` : '/join'),
  room: (roomCode: string) => `/room/${encodeURIComponent(roomCode)}`,
} as const
