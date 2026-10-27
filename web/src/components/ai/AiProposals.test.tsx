import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AiActionDto } from '@livepulse/shared'
import { AiProposalsView, type AiProposalsViewProps } from './AiProposals'

const action = (over: Partial<AiActionDto> = {}, n = 1): AiActionDto => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  type: 'CREATE_POLL',
  status: 'PROPOSED',
  details: { question: 'Favourite colour?' },
  resultId: null,
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  decidedAt: null,
  finishedAt: null,
  ...over,
})

const render = (over: Partial<AiProposalsViewProps> = {}): string =>
  renderToStaticMarkup(
    <AiProposalsView
      actions={[]}
      status="ready"
      error={null}
      pendingIds={new Set()}
      onApprove={() => undefined}
      onReject={() => undefined}
      onRetry={() => undefined}
      {...over}
    />,
  )

describe('Claude suggestions', () => {
  it('shows loading text while proposals load', () => {
    const html = render({ status: 'loading' })
    expect(html).toContain('Claude suggestions')
    expect(html).toContain('Loading Claude suggestions')
    expect(html).toContain('aria-live="polite"')
  })

  it('shows the empty message when nothing is waiting', () => {
    expect(render()).toContain('Nothing waiting for approval.')
  })

  it('lists a proposal with its summary and approve and reject buttons', () => {
    const html = render({ actions: [action()] })
    expect(html).toContain('Create poll: Favourite colour?')
    expect(html).toContain('Approve')
    expect(html).toContain('Reject')
    expect(html).not.toContain('disabled=""')
  })

  it('summarises publishing an answer by the question text', () => {
    const html = render({
      actions: [action({ type: 'PUBLISH_ANSWER', details: { questionText: 'Why?' } })],
    })
    expect(html).toContain('Publish answer to: Why?')
  })

  it('disables approve and reject while the decision is in flight', () => {
    const a = action()
    const html = render({ actions: [a], pendingIds: new Set([a.id]) })
    expect(html.match(/disabled=""/g)?.length).toBe(2)
  })

  it('shows the failure reason as text', () => {
    const html = render({
      actions: [action({ status: 'FAILED', errorCode: 'POLL_NOT_FOUND', errorMessage: 'Poll is gone.' })],
    })
    expect(html).toContain('Could not finish: Poll is gone.')
    expect(html).not.toContain('Approve')
  })

  it('shows rejected and done outcomes without buttons', () => {
    const html = render({ actions: [action({ status: 'REJECTED' }, 1), action({ status: 'EXECUTED' }, 2)] })
    expect(html).toContain('Rejected')
    expect(html).toContain('Done')
    expect(html).not.toContain('Approve')
  })

  it('shows the error with a retry', () => {
    const html = render({ status: 'error', error: 'Could not reach LivePulse.' })
    expect(html).toContain('Could not reach LivePulse.')
    expect(html).toContain('Try again')
  })

  it('does not render audience text as HTML', () => {
    const html = render({
      actions: [action({ type: 'PUBLISH_ANSWER', details: { questionText: '<b>x</b>' } })],
    })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('renders at most ten items', () => {
    const many = Array.from({ length: 15 }, (_, i) => action({}, i + 1))
    expect(render({ actions: many }).match(/<li /g)?.length).toBe(10)
  })
})
