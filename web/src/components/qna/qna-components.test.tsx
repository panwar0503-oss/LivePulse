import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParticipantQuestion, PresenterQuestion } from '@livepulse/shared'
import { AnswerForm, stripLineBreaks } from './AnswerForm'
import { ParticipantQna } from './ParticipantQna'
import { QnaPanel } from './QnaPanel'
import { qnaErrorMessage } from './qna-messages'

const base = {
  upvotes: 0,
  pinned: false,
  answered: false,
  answerText: null,
  answeredAt: null,
  createdAt: '2026-10-24T10:00:00.000Z',
}
const pq = (n: number, over: Partial<ParticipantQuestion> = {}): ParticipantQuestion => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${n}`,
  text: `Question ${n}`,
  mine: false,
  myUpvote: false,
  ...over,
})
const rq = (n: number, over: Partial<PresenterQuestion> = {}): PresenterQuestion => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${n}`,
  text: `Question ${n}`,
  hidden: false,
  ...over,
})

const participantProps = {
  qnaOpen: true,
  status: 'ready' as const,
  onRetry: () => undefined,
  asking: false,
  onAsk: () => Promise.resolve(true),
  onUpvote: () => undefined,
}
const panelProps = {
  qnaOpen: true,
  status: 'ready' as const,
  onRetry: () => undefined,
  switchPending: false,
  onToggleQna: () => undefined,
  onPin: () => undefined,
  onHide: () => undefined,
  onAnswered: () => undefined,
  onSaveAnswer: () => undefined,
  onClearAnswer: () => undefined,
}

describe('Q&A screens', () => {
  it('shows the list in the order it was given, never re-sorted', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna {...participantProps} questions={[pq(1, { upvotes: 0 }), pq(2, { upvotes: 9 })]} />,
    )
    expect(html.indexOf('Question 1')).toBeLessThan(html.indexOf('Question 2'))
    const panel = renderToStaticMarkup(
      <QnaPanel {...panelProps} questions={[rq(1, { upvotes: 0 }), rq(2, { upvotes: 9 })]} />,
    )
    expect(panel.indexOf('Question 1')).toBeLessThan(panel.indexOf('Question 2'))
  })

  it('renders a typed <b> tag as plain text in a question and in an answer', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna
        {...participantProps}
        questions={[pq(1, { text: '<b>bold</b>', answerText: '<b>yes</b>', answered: true })]}
      />,
    )
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
    expect(html).toContain('&lt;b&gt;yes&lt;/b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('shows the paused notice and disables asking and upvoting when Q&A is closed', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna {...participantProps} qnaOpen={false} questions={[pq(1)]} />,
    )
    expect(html).toContain('Q&amp;A is paused by the presenter.')
    expect(html).toContain('Question 1')
    expect(html).toMatch(/<input[^>]*disabled/)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Upvote</)
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Ask</)
  })

  it('shows Upvoted and a check icon after the participant upvotes, not colour alone', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna {...participantProps} questions={[pq(1, { myUpvote: true, upvotes: 1 })]} />,
    )
    expect(html).toContain('Upvoted')
    expect(html).toContain('<svg')
    expect(html).toContain('1 upvote<')
    expect(html).not.toMatch(/>Upvote</)
  })

  it("shows no upvote button on the participant's own question", () => {
    const html = renderToStaticMarkup(
      <ParticipantQna {...participantProps} questions={[pq(1, { mine: true })]} />,
    )
    expect(html).toContain('Your question')
    expect(html).not.toMatch(/>Upvote</)
  })

  it('shows the answer labelled as from the presenter', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna {...participantProps} questions={[pq(1, { answerText: 'See slide 4' })]} />,
    )
    expect(html).toContain('Answer from the presenter')
    expect(html).toContain('See slide 4')
  })

  it('hides hidden questions from the participant list (the presenter view shows them in a Hidden section)', () => {
    const presenter = renderToStaticMarkup(
      <QnaPanel {...panelProps} questions={[rq(1), rq(2, { hidden: true, text: 'Secret one' })]} />,
    )
    expect(presenter).toContain('Hidden questions')
    expect(presenter).toContain('Secret one')
    expect(presenter).toContain('Show')
    // Participants are only ever given the visible list by the server.
    const participant = renderToStaticMarkup(<ParticipantQna {...participantProps} questions={[pq(1)]} />)
    expect(participant).not.toContain('Secret one')
    expect(participant).not.toContain('Hidden')
  })

  it('keeps the list region polite and announces the count only', () => {
    const html = renderToStaticMarkup(<ParticipantQna {...participantProps} questions={[pq(1), pq(2)]} />)
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-live="polite"[^>]*>2 questions</)
    expect(html).not.toMatch(/<ul[^>]*aria-live/)
  })

  it('the answer input refuses line breaks and shows a 500-character counter', () => {
    const html = renderToStaticMarkup(
      <AnswerForm
        questionId="q1"
        initialAnswer={null}
        pending={false}
        onSave={() => undefined}
        onClear={() => undefined}
      />,
    )
    expect(html).toContain('type="text"')
    expect(html).toContain('maxLength="500"')
    expect(html).toContain('0/500 characters')
    expect(html).not.toContain('<textarea')
    expect(stripLineBreaks('a\nb\r\nc')).toBe('a b c')
  })

  it('shows an empty state, a pinned badge, upvote words and the switch to the presenter', () => {
    expect(renderToStaticMarkup(<QnaPanel {...panelProps} questions={[]} />)).toContain(
      'No questions yet. Participants can ask from their phones.',
    )
    const html = renderToStaticMarkup(
      <QnaPanel {...panelProps} questions={[rq(1, { pinned: true, upvotes: 3, answered: true })]} />,
    )
    expect(html).toContain('Pinned')
    expect(html).toContain('Answered')
    expect(html).toContain('3 upvotes')
    expect(html).toContain('role="switch"')
    expect(html).toContain('Unpin')
    expect(html).toContain('Mark unanswered')
  })

  it('explains refusals in plain words and falls back to the server message', () => {
    expect(qnaErrorMessage('UPVOTE_ALREADY_RECORDED')).toBe('You already upvoted this question.')
    expect(qnaErrorMessage('QNA_CLOSED')).toBe('Q&A is paused by the presenter.')
    expect(qnaErrorMessage('SOMETHING_NEW', 'Server says no')).toBe('Server says no')
  })
})
