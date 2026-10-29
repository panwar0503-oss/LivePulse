import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Cluster, HeldQuestion, ParticipantQuestion, ReviewDraft } from '@livepulse/shared'
import { approveBody } from '../../lib/api/qna-copilot-client'
import { ClustersPanel } from './ClustersPanel'
import { CopilotReview, type CopilotReviewProps } from './CopilotReview'
import { ParticipantQna } from './ParticipantQna'
import { qnaErrorMessage } from './qna-messages'

const noop = (): void => undefined
const props = (over: Partial<CopilotReviewProps> = {}): CopilotReviewProps => ({
  status: 'ready',
  held: [],
  drafts: [],
  error: null,
  busyId: null,
  onApprove: noop,
  onReject: noop,
  onRelease: noop,
  onRejectHeld: noop,
  onRetry: noop,
  ...over,
})

const held = (label: HeldQuestion['label']): HeldQuestion => ({
  questionId: '00000000-0000-4000-8000-000000000001',
  text: 'Is this rude?',
  label,
  createdAt: '2026-10-25T10:00:00.000Z',
})
const draft = (over: Partial<ReviewDraft> = {}): ReviewDraft => ({
  id: '00000000-0000-4000-8000-0000000000d1',
  questionId: '00000000-0000-4000-8000-000000000002',
  questionText: 'When is the refund window?',
  status: 'PENDING_REVIEW',
  outcome: 'GROUNDED',
  text: 'Refunds are open for 30 days.',
  language: 'en',
  confidence: 0.8,
  citations: [{ documentName: 'Policy.pdf', location: { kind: 'page', number: 3 }, quote: 'SECRET QUOTE' }],
  ...over,
})

const base = {
  upvotes: 0,
  pinned: false,
  answered: false,
  answerText: null,
  answeredAt: null,
  createdAt: '2026-10-25T10:00:00.000Z',
  myUpvote: false,
}
const pq = (n: number, over: Partial<ParticipantQuestion>): ParticipantQuestion => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${n}`,
  text: `Question ${n}`,
  mine: false,
  ...over,
})
const participantProps = {
  qnaOpen: true,
  status: 'ready' as const,
  onRetry: noop,
  asking: false,
  onAsk: () => Promise.resolve(true),
  onUpvote: noop,
}

describe('Q&A copilot review', () => {
  it('the review shows a held question with release and reject', () => {
    const html = renderToStaticMarkup(<CopilotReview {...props({ held: [held('SPAM')] })} />)
    expect(html).toContain('Is this rude?')
    expect(html).toContain('Flagged as SPAM')
    expect(html).toContain('Release')
    expect(html).toContain('Reject')
    const none = renderToStaticMarkup(<CopilotReview {...props({ held: [held(null)] })} />)
    expect(none).not.toContain('Flagged as')
  })

  it('a draft shows its text, citations and approve', () => {
    const html = renderToStaticMarkup(<CopilotReview {...props({ drafts: [draft()] })} />)
    expect(html).toContain('Refunds are open for 30 days.')
    expect(html).toContain('Policy.pdf')
    expect(html).not.toContain('Page 3')
    expect(html).not.toContain('SECRET QUOTE')
    expect(html).toContain('maxLength="500"')
    expect(html).toContain('High confidence')
    expect(html).toContain('Approve')
  })

  it('a not-covered draft offers write by hand', () => {
    const html = renderToStaticMarkup(
      <CopilotReview
        {...props({
          drafts: [draft({ outcome: 'NOT_COVERED', text: null, confidence: null, citations: [] })],
        })}
      />,
    )
    expect(html).toContain('Not covered in the materials')
    expect(html).toContain('Write an answer by hand')
    expect(html).not.toContain('>Approve')
  })

  it('approve sends the edited text only when it changed', () => {
    expect(approveBody('Same answer', 'Same answer')).toEqual({})
    expect(approveBody('Same answer', 'Better answer')).toEqual({ text: 'Better answer' })
  })

  it('a 409 shows the plain conflict copy', () => {
    expect(qnaErrorMessage('DRAFT_NOT_PENDING')).toBe('This draft was already handled.')
    expect(qnaErrorMessage('QUESTION_ALREADY_ANSWERED')).toBe('This question was already answered.')
    expect(qnaErrorMessage('QUESTION_NOT_VISIBLE')).toBe('This question is no longer visible.')
    expect(qnaErrorMessage('QUESTION_NOT_HELD')).toBe('This question was already handled.')
    const html = renderToStaticMarkup(
      <CopilotReview {...props({ error: { code: 'DRAFT_NOT_PENDING', message: 'raw server text' } })} />,
    )
    expect(html).toContain('This draft was already handled.')
    expect(html).not.toContain('raw server text')
  })

  it('the clusters panel says it needs three questions', () => {
    const cluster: Cluster = {
      id: 'c1',
      label: 'Refunds',
      size: 2,
      questionIds: ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'],
    }
    const html = renderToStaticMarkup(<ClustersPanel clusters={[cluster]} questionTexts={new Map()} />)
    expect(html).toContain('Clusters appear once three questions are grouped.')
    const ready = renderToStaticMarkup(
      <ClustersPanel
        clusters={[{ ...cluster, size: 3 }]}
        questionTexts={new Map([['00000000-0000-4000-8000-000000000001', 'How do refunds work?']])}
      />,
    )
    expect(ready).toContain('Refunds')
    expect(ready).toContain('3 questions')
    expect(ready).toContain('How do refunds work?')
  })
})

describe('participant status', () => {
  it('a participant sees checking and merged status only on their own question', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna
        {...participantProps}
        questions={[
          pq(1, { mine: true, status: 'CHECKING' }),
          pq(2, { mine: true, status: 'MERGED' }),
          pq(3, { mine: false, status: 'CHECKING' }),
        ]}
      />,
    )
    expect(html).toContain('Checking…')
    expect(html.match(/Checking…/g)).toHaveLength(1)
    expect(html).toContain('Similar question already asked — upvoted it.')
  })

  it('an answered question shows the answer as plain text', () => {
    const html = renderToStaticMarkup(
      <ParticipantQna
        {...participantProps}
        questions={[pq(1, { answered: true, answerText: '<b>Yes</b> on Friday' })]}
      />,
    )
    expect(html).toContain('&lt;b&gt;Yes&lt;/b&gt; on Friday')
    expect(html).not.toContain('<b>Yes</b>')
  })
})
