import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChatTurn } from '@livepulse/shared'
import { ReportChatView, type ReportChatViewProps } from './ReportChat'
import { announcement, counterText, refusalCopy, toolProgress } from './report-chat-copy'

const turn = (over: Partial<ChatTurn> = {}): ChatTurn => ({
  id: '11111111-1111-4111-8111-111111111111',
  question: 'Which poll won?',
  answer: 'Pizza won with 60%.',
  status: 'COMPLETE',
  errorCode: null,
  sources: [],
  createdAt: '2026-01-01T10:00:00.000Z',
  ...over,
})

const render = (over: Partial<ReportChatViewProps> = {}): string =>
  renderToStaticMarkup(
    <ReportChatView
      turns={[]}
      loading={false}
      loadError={null}
      live={null}
      phase="idle"
      notice={null}
      question=""
      onQuestionChange={() => undefined}
      onSend={() => undefined}
      onStop={() => undefined}
      onAskAgain={() => undefined}
      onRetryLoad={() => undefined}
      {...over}
    />,
  )

describe('report chat', () => {
  it('a chat answer shows its sources as labels', () => {
    const html = render({
      turns: [
        turn({
          sources: [
            { kind: 'poll', ref: 'p1', label: 'Favourite food' },
            { kind: 'document', ref: 'd1', label: 'handbook.pdf' },
          ],
        }),
      ],
    })
    expect(html).toContain('Poll: Favourite food')
    expect(html).toContain('Document: handbook.pdf')
    expect(html).toContain('Pizza won with 60%.')
  })

  it('a stopped answer offers to ask again', () => {
    const html = render({ turns: [turn({ status: 'INCOMPLETE', answer: 'Pizza w' })] })
    expect(html).toContain('Answer stopped early')
    expect(html).toContain('Ask again')
  })

  it('a refused question shows the copy for its reason', () => {
    expect(refusalCopy(503, 'AI_DISABLED', 'x')).toBe('Turn AI on for this session to ask questions.')
    expect(refusalCopy(409, 'AI_OFF_FOR_SESSION', 'x')).toBe('Turn AI on for this session to ask questions.')
    expect(refusalCopy(409, 'AI_BUDGET_EXHAUSTED', 'x')).toBe('This session has used its AI budget.')
    expect(refusalCopy(409, 'CHAT_BUSY', 'x')).toBe('An answer is already being written.')
    expect(refusalCopy(409, 'DUPLICATE_MESSAGE', 'x')).toBe('This question was already sent.')
    expect(refusalCopy(429, 'RATE_LIMITED', 'x')).toBe(
      'You are asking too quickly. Wait a minute and try again.',
    )
    expect(render({ notice: refusalCopy(409, 'CHAT_BUSY', 'x') })).toContain(
      'An answer is already being written.',
    )
  })

  it('the question input has a limit and a counter near it', () => {
    const html = render({ question: 'a'.repeat(450) })
    expect(html).toContain('maxLength="500"')
    expect(html).toContain('450 / 500')
    expect(html).toContain('Your question')
    expect(counterText(10)).toBeNull()
  })

  it('the streaming answer is announced politely, not token by token', () => {
    expect(announcement('writing')).toBe('Writing…')
    expect(announcement('done')).toBe('Answer ready.')
    expect(announcement('idle')).toBe('')
    const html = render({
      phase: 'writing',
      live: { question: 'Q?', text: 'Pizza', tool: 'get_poll_results' },
    })
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Stop')
    expect(html).toContain('Looking at polls…')
    expect(toolProgress('get_documents')).toBe('Looking at documents…')
  })
})
