import { describe, expect, it } from 'vitest'
import {
  initialSessionSocketState,
  sessionSocketReducer,
  type SessionSocketEvent,
  type SessionSocketState,
} from './session-socket-state'

const SESSION_ID = '4c3a1c2e-8a8f-4f4b-9b8e-2f3d4c5b6a7e'

const run = (events: SessionSocketEvent[], start: SessionSocketState = initialSessionSocketState) =>
  events.reduce((state, event) => sessionSocketReducer(state, event).state, start)

const connected = run([{ type: 'connect' }])

const presence = (connectedCount: number, countedAt: number): SessionSocketEvent => ({
  type: 'presence',
  payload: { sessionId: SESSION_ID, connected: connectedCount, countedAt },
})

describe('live connection state', () => {
  it('starts as connecting with no count and the session not ended', () => {
    expect(initialSessionSocketState).toMatchObject({
      status: 'connecting',
      connectedCount: null,
      ended: false,
      degraded: false,
      refusedReason: null,
    })
  })

  it('becomes connected and asks the page to refetch on the first connection', () => {
    const { state, effects } = sessionSocketReducer(initialSessionSocketState, { type: 'connect' })
    expect(state.status).toBe('connected')
    expect(effects.refetch).toBe(true)
  })

  it('asks the page to refetch again after every reconnect', () => {
    const lost = run([{ type: 'disconnect', reason: 'transport close' }], connected)
    const { state, effects } = sessionSocketReducer(lost, { type: 'connect' })
    expect(state.status).toBe('connected')
    expect(effects.refetch).toBe(true)
  })

  it('shows the latest connected count', () => {
    expect(run([presence(3, 100)], connected)).toMatchObject({ connectedCount: 3, countedAt: 100 })
  })

  it('ignores a count that arrives after a newer one', () => {
    expect(run([presence(5, 200), presence(2, 150)], connected).connectedCount).toBe(5)
  })

  it('ignores a count taken at the same moment as the one already shown', () => {
    expect(run([presence(5, 200), presence(9, 200)], connected).connectedCount).toBe(5)
  })

  it('marks the session ended with the time it ended', () => {
    const ended = run(
      [{ type: 'ended', payload: { sessionId: SESSION_ID, endedAt: '2026-10-24T10:00:00.000Z' } }],
      connected,
    )
    expect(ended).toMatchObject({ ended: true, endedAt: '2026-10-24T10:00:00.000Z' })
  })

  it('keeps the first end time when the end is announced twice', () => {
    const ended = run(
      [
        { type: 'ended', payload: { sessionId: SESSION_ID, endedAt: '2026-10-24T10:00:00.000Z' } },
        { type: 'ended', payload: { sessionId: SESSION_ID, endedAt: '2026-10-24T10:05:00.000Z' } },
      ],
      connected,
    )
    expect(ended.endedAt).toBe('2026-10-24T10:00:00.000Z')
  })

  it('shows reconnecting when the server says it is restarting', () => {
    expect(run([{ type: 'error', code: 'SERVER_RESTARTING' }], connected).status).toBe('reconnecting')
  })

  it('reconnects by itself when the server closes the connection', () => {
    const { state, effects } = sessionSocketReducer(connected, {
      type: 'disconnect',
      reason: 'io server disconnect',
    })
    expect(state.status).toBe('reconnecting')
    expect(effects.reconnect).toBe(true)
  })

  it('shows reconnecting on network loss and leaves retrying to the connection library', () => {
    const { state, effects } = sessionSocketReducer(connected, {
      type: 'disconnect',
      reason: 'transport close',
    })
    expect(state.status).toBe('reconnecting')
    expect(effects.reconnect).toBe(false)
  })

  it('shows disconnected when the page closes the connection itself', () => {
    expect(run([{ type: 'disconnect', reason: 'io client disconnect' }], connected).status).toBe(
      'disconnected',
    )
  })

  it.each(['UNAUTHORIZED', 'FORBIDDEN_ORIGIN', 'TOO_MANY_CONNECTIONS'] as const)(
    'stops trying when the server refuses the connection (%s)',
    (code) => {
      const { state, effects } = sessionSocketReducer(initialSessionSocketState, {
        type: 'connect_error',
        message: code,
      })
      expect(state).toMatchObject({ status: 'refused', refusedReason: code })
      expect(effects).toMatchObject({ stop: true, reconnect: false })
    },
  )

  it('stays refused even if the closing connection reports more events', () => {
    const refused = run([{ type: 'connect_error', message: 'UNAUTHORIZED' }])
    const after = run([{ type: 'disconnect', reason: 'io client disconnect' }, { type: 'connect' }], refused)
    expect(after).toMatchObject({ status: 'refused', refusedReason: 'UNAUTHORIZED' })
  })

  it('keeps retrying after any other connection error without exposing its text', () => {
    const { state, effects } = sessionSocketReducer(connected, {
      type: 'connect_error',
      message: 'websocket error: internal detail',
    })
    expect(state).toMatchObject({ status: 'reconnecting', refusedReason: null })
    expect(effects).toMatchObject({ reconnect: true, stop: false })
  })

  it('stays connecting while the first connection attempt keeps failing', () => {
    expect(run([{ type: 'connect_error', message: 'timeout' }]).status).toBe('connecting')
  })

  it('flags live updates as degraded and clears the flag when they are restored', () => {
    const degraded = run([{ type: 'error', code: 'REALTIME_DEGRADED' }], connected)
    expect(degraded.degraded).toBe(true)
    const { state, effects } = sessionSocketReducer(degraded, { type: 'error', code: 'REALTIME_RESTORED' })
    expect(state.degraded).toBe(false)
    expect(effects.refetch).toBe(true)
  })

  it('does not ask for a refetch when live updates become degraded', () => {
    expect(
      sessionSocketReducer(connected, { type: 'error', code: 'REALTIME_DEGRADED' }).effects.refetch,
    ).toBe(false)
  })
})

describe('live word cloud state', () => {
  const PROMPT_ID = '33333333-3333-4333-8333-333333333333'
  const cloudAt = (version: number): SessionSocketEvent => ({
    type: 'wordcloud_results',
    payload: {
      promptId: PROMPT_ID,
      total: version,
      version,
      entries: [{ key: 'a', word: 'a', count: version }],
    },
  })

  it('keeps the newest word cloud and drops an older version', () => {
    expect(run([cloudAt(5), cloudAt(3), cloudAt(5)], connected).wordClouds[PROMPT_ID]?.version).toBe(5)
    expect(run([cloudAt(5), cloudAt(6)], connected).wordClouds[PROMPT_ID]?.version).toBe(6)
  })

  it('asks for a refetch when a word prompt opens', () => {
    const { state, effects } = sessionSocketReducer(connected, {
      type: 'wordcloud_started',
      payload: { prompt: { id: PROMPT_ID, question: 'Q', showCloud: true } },
    })
    expect(effects.refetch).toBe(true)
    expect(state.openWordPromptId).toBe(PROMPT_ID)
  })

  it("asks for a refetch when the cloud's visibility changes", () => {
    const { effects } = sessionSocketReducer(connected, {
      type: 'wordcloud_updated',
      payload: { promptId: PROMPT_ID, showCloud: false },
    })
    expect(effects.refetch).toBe(true)
  })
})

describe('live poll state', () => {
  const POLL_ID = '11111111-1111-4111-8111-111111111111'
  const OPT = '22222222-2222-4222-8222-222222222222'
  const results = (version: number): SessionSocketEvent => ({
    type: 'poll_results',
    payload: { pollId: POLL_ID, total: version, version, options: [{ id: OPT, count: version, pct: 100 }] },
  })
  const started: SessionSocketEvent = {
    type: 'poll_started',
    payload: { poll: { id: POLL_ID, question: 'Q', options: [], showResults: true } },
  }

  it('keeps the newest poll results and drops an older version', () => {
    expect(run([results(5), results(3), results(5)], connected).pollResults[POLL_ID]?.version).toBe(5)
    expect(run([results(5), results(6)], connected).pollResults[POLL_ID]?.version).toBe(6)
  })

  it('asks for a refetch when a poll starts', () => {
    const { state, effects } = sessionSocketReducer(connected, started)
    expect(effects.refetch).toBe(true)
    expect(state.openPollId).toBe(POLL_ID)
  })

  it("asks for a refetch when a poll's results visibility changes", () => {
    const { effects } = sessionSocketReducer(connected, {
      type: 'poll_updated',
      payload: { pollId: POLL_ID, showResults: false },
    })
    expect(effects.refetch).toBe(true)
  })

  it('marks the open poll closed and asks for a refetch', () => {
    const { state, effects } = sessionSocketReducer(run([started], connected), {
      type: 'poll_closed',
      payload: { pollId: POLL_ID, closedAt: '2026-01-01T00:00:00.000Z' },
    })
    expect(state.openPollId).toBeNull()
    expect(state.closedNotice?.pollId).toBe(POLL_ID)
    expect(effects.refetch).toBe(true)
  })
})
