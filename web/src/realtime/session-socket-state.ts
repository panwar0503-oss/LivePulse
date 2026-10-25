import type {
  AiJobFailed,
  AiStatus,
  AiUsage,
  PollClosed,
  PollResults,
  PollResultsEvent,
  PollStarted,
  PollUpdated,
  PresenceCount,
  QnaStatus,
  QuestionCreated,
  QuestionUpdated,
  QuestionUpvotes,
  RealtimeErrorCode,
  SessionEnded,
  WordCloud,
  WordcloudClosed,
  WordcloudResults,
  WordcloudStarted,
  WordcloudUpdated,
} from '@livepulse/shared'

export const REFUSAL_CODES = ['UNAUTHORIZED', 'FORBIDDEN_ORIGIN', 'TOO_MANY_CONNECTIONS'] as const
export type RefusalCode = (typeof REFUSAL_CODES)[number]

export type SocketStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'refused'

export type SessionSocketState = {
  status: SocketStatus
  connectedCount: number | null
  countedAt: number | null
  ended: boolean
  endedAt: string | null
  degraded: boolean
  refusedReason: RefusalCode | null
  // Latest live results per poll id; only ever replaced by a newer version.
  pollResults: Record<string, PollResults>
  openPollId: string | null
  closedNotice: { pollId: string; closedAt: string } | null
  // Latest live word cloud per prompt id; only ever replaced by a newer version.
  wordClouds: Record<string, WordCloud>
  openWordPromptId: string | null
  wordClosedNotice: { promptId: string; closedAt: string } | null
  // Latest upvote list; only ever replaced by a newer version.
  qnaUpvotes: QuestionUpvotes | null
  // Last Q&A open flag announced live; null until a status event arrives (the snapshot has the rest).
  qnaOpen: boolean | null
  // Latest AI events for the presenter; the HTTP state is the base and the hook overlays these.
  aiStatus: AiStatus | null
  aiUsage: AiUsage | null
  aiFailure: AiJobFailed | null
}

export type SessionSocketEvent =
  | { type: 'connect' }
  | { type: 'disconnect'; reason: string }
  | { type: 'connect_error'; message: string }
  | { type: 'presence'; payload: PresenceCount }
  | { type: 'ended'; payload: SessionEnded }
  | { type: 'error'; code: RealtimeErrorCode }
  | { type: 'poll_started'; payload: PollStarted }
  | { type: 'poll_closed'; payload: PollClosed }
  | { type: 'poll_updated'; payload: PollUpdated }
  | { type: 'poll_results'; payload: PollResultsEvent }
  | { type: 'wordcloud_started'; payload: WordcloudStarted }
  | { type: 'wordcloud_closed'; payload: WordcloudClosed }
  | { type: 'wordcloud_updated'; payload: WordcloudUpdated }
  | { type: 'wordcloud_results'; payload: WordcloudResults }
  | { type: 'question_created'; payload: QuestionCreated }
  | { type: 'question_upvotes'; payload: QuestionUpvotes }
  | { type: 'question_updated'; payload: QuestionUpdated }
  | { type: 'qna_status'; payload: QnaStatus }
  | { type: 'ai_status'; payload: AiStatus }
  | { type: 'ai_usage'; payload: AiUsage }
  | { type: 'ai_job_failed'; payload: AiJobFailed }

// Side effects the hook performs after applying the new state; the reducer itself stays pure.
export type SessionSocketEffects = {
  refetch: boolean
  reconnect: boolean
  stop: boolean
}

export type SessionSocketTransition = { state: SessionSocketState; effects: SessionSocketEffects }

export const initialSessionSocketState: SessionSocketState = {
  status: 'connecting',
  connectedCount: null,
  countedAt: null,
  ended: false,
  endedAt: null,
  degraded: false,
  refusedReason: null,
  pollResults: {},
  openPollId: null,
  closedNotice: null,
  wordClouds: {},
  openWordPromptId: null,
  wordClosedNotice: null,
  qnaUpvotes: null,
  qnaOpen: null,
  aiStatus: null,
  aiUsage: null,
  aiFailure: null,
}

const NO_EFFECTS: SessionSocketEffects = { refetch: false, reconnect: false, stop: false }

const isRefusal = (message: string): message is RefusalCode =>
  (REFUSAL_CODES as readonly string[]).includes(message)

const same = (state: SessionSocketState): SessionSocketTransition => ({ state, effects: NO_EFFECTS })

export const sessionSocketReducer = (
  state: SessionSocketState,
  event: SessionSocketEvent,
): SessionSocketTransition => {
  // A refused connection is final for this page; late events from the closing socket change nothing.
  if (state.status === 'refused') return same(state)

  switch (event.type) {
    case 'connect':
      // Rooms are joined before CONNECT, so a refetch now cannot miss an event.
      return { state: { ...state, status: 'connected' }, effects: { ...NO_EFFECTS, refetch: true } }

    case 'disconnect':
      if (event.reason === 'io client disconnect') return same({ ...state, status: 'disconnected' })
      // Socket.IO does not reconnect by itself when the server closed the connection.
      return {
        state: { ...state, status: 'reconnecting' },
        effects: { ...NO_EFFECTS, reconnect: event.reason === 'io server disconnect' },
      }

    case 'connect_error':
      if (isRefusal(event.message)) {
        return {
          state: { ...state, status: 'refused', refusedReason: event.message },
          effects: { ...NO_EFFECTS, stop: true },
        }
      }
      return {
        state: { ...state, status: state.status === 'connecting' ? 'connecting' : 'reconnecting' },
        effects: { ...NO_EFFECTS, reconnect: true },
      }

    case 'presence':
      // Counts from different instances can arrive out of order; keep only newer ones.
      if (state.countedAt !== null && event.payload.countedAt <= state.countedAt) return same(state)
      return same({ ...state, connectedCount: event.payload.connected, countedAt: event.payload.countedAt })

    case 'ended':
      if (state.ended) return same(state)
      return same({ ...state, ended: true, endedAt: event.payload.endedAt })

    case 'error':
      if (event.code === 'SERVER_RESTARTING') return same({ ...state, status: 'reconnecting' })
      if (event.code === 'REALTIME_DEGRADED') return same({ ...state, degraded: true })
      // RESTORED: events may have been lost while degraded, so refetch once.
      return { state: { ...state, degraded: false }, effects: { ...NO_EFFECTS, refetch: true } }

    case 'poll_started':
      return {
        state: { ...state, openPollId: event.payload.poll.id, closedNotice: null },
        effects: { ...NO_EFFECTS, refetch: true },
      }

    case 'poll_closed':
      return {
        state: {
          ...state,
          openPollId: state.openPollId === event.payload.pollId ? null : state.openPollId,
          closedNotice: { pollId: event.payload.pollId, closedAt: event.payload.closedAt },
        },
        effects: { ...NO_EFFECTS, refetch: true },
      }

    case 'poll_updated':
      return { state, effects: { ...NO_EFFECTS, refetch: true } }

    case 'poll_results': {
      const { pollId, ...results } = event.payload
      const stored = state.pollResults[pollId]
      // Updates can arrive out of order across instances; drop older or equal versions.
      if (stored && results.version <= stored.version) return same(state)
      return same({ ...state, pollResults: { ...state.pollResults, [pollId]: results } })
    }

    case 'wordcloud_started':
      return {
        state: { ...state, openWordPromptId: event.payload.prompt.id, wordClosedNotice: null },
        effects: { ...NO_EFFECTS, refetch: true },
      }

    case 'wordcloud_closed':
      return {
        state: {
          ...state,
          openWordPromptId: state.openWordPromptId === event.payload.promptId ? null : state.openWordPromptId,
          wordClosedNotice: { promptId: event.payload.promptId, closedAt: event.payload.closedAt },
        },
        effects: { ...NO_EFFECTS, refetch: true },
      }

    case 'wordcloud_updated':
      return { state, effects: { ...NO_EFFECTS, refetch: true } }

    case 'wordcloud_results': {
      const { promptId, ...cloud } = event.payload
      const stored = state.wordClouds[promptId]
      // Drop older or equal versions that arrive out of order.
      if (stored && cloud.version <= stored.version) return same(state)
      return same({ ...state, wordClouds: { ...state.wordClouds, [promptId]: cloud } })
    }

    // The refetch returns the full ordered list, so a created or changed question needs no local merge.
    case 'question_created':
    case 'question_updated':
      return { state, effects: { ...NO_EFFECTS, refetch: true } }

    case 'question_upvotes':
      // Drop older or equal versions that arrive out of order.
      if (state.qnaUpvotes && event.payload.version <= state.qnaUpvotes.version) return same(state)
      return same({ ...state, qnaUpvotes: event.payload })

    case 'qna_status':
      return { state: { ...state, qnaOpen: event.payload.open }, effects: { ...NO_EFFECTS, refetch: true } }

    case 'ai_status':
      return same({ ...state, aiStatus: event.payload })

    case 'ai_usage':
      return same({ ...state, aiUsage: event.payload })

    case 'ai_job_failed':
      return same({ ...state, aiFailure: event.payload })
  }
}
