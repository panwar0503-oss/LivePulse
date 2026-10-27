import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { SessionReport as ReportData } from '@livepulse/shared'
import { SessionReport } from './SessionReport'

const noop = (): void => undefined
const ID = '00000000-0000-4000-8000-000000000001'

const emptyReport = (over: Partial<ReportData> = {}): ReportData => ({
  session: { title: 'Town hall', status: 'ACTIVE', endedAt: null },
  polls: [],
  wordPrompts: [],
  questions: { total: 0, answered: 0, unanswered: 0, hidden: 0, top: [] },
  documents: { items: [], removedAtEnd: false },
  aiUsage: { tokensUsed: 0, tokenBudget: 1000, byTask: [] },
  generatedAt: '2026-10-25T10:00:00.000Z',
  final: false,
  ...over,
})

const render = (report: ReportData | null, status: 'loading' | 'error' | 'ready' = 'ready'): string =>
  renderToStaticMarkup(
    <SessionReport sessionId={ID} report={report} status={status} error={null} onRetry={noop} />,
  )

describe('session report', () => {
  it('the report shows poll results with percentages', () => {
    const html = render(
      emptyReport({
        polls: [
          {
            id: ID,
            question: 'Lunch?',
            status: 'CLOSED',
            total: 4,
            options: [
              { label: 'Pizza', count: 3, pct: 75 },
              { label: 'Salad', count: 1, pct: 25 },
            ],
          },
        ],
      }),
    )
    expect(html).toContain('Lunch?')
    expect(html).toContain('3 of 4 votes (75%)')
    expect(html).toContain('1 of 4 votes (25%)')
  })

  it('after the session ends the report says documents are removed', () => {
    const html = render(
      emptyReport({
        session: { title: 'Town hall', status: 'ENDED', endedAt: '2026-10-25T11:00:00.000Z' },
        documents: { items: [], removedAtEnd: true, processedCount: 2 },
        final: true,
      }),
    )
    expect(html).toContain('Documents are removed when the session ends.')
    expect(html).toContain('2 documents were processed.')
    expect(html).toContain('Final')
  })

  it('an empty session says nothing is recorded', () => {
    expect(render(emptyReport())).toContain('Nothing has been recorded in this session yet.')
  })

  it('the export button is labelled', () => {
    expect(render(emptyReport())).toContain('Export report')
  })

  it("a question's text is shown as plain text", () => {
    const html = render(
      emptyReport({
        questions: {
          total: 1,
          answered: 0,
          unanswered: 1,
          hidden: 0,
          top: [{ id: ID, text: '<b>Why?</b>', upvotes: 2, answered: false }],
        },
      }),
    )
    expect(html).toContain('&lt;b&gt;Why?&lt;/b&gt;')
    expect(html).not.toContain('<b>Why?</b>')
  })

  it('a failed load offers to try again', () => {
    const html = renderToStaticMarkup(
      <SessionReport
        sessionId={ID}
        report={null}
        status="error"
        error={{ message: 'Nope' }}
        onRetry={noop}
      />,
    )
    expect(html).toContain('Try again')
  })
})
