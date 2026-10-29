import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PollSuggestion, PollSuggestionsResult } from '@livepulse/shared'
import { CreatePollForm } from './CreatePollForm'
import { PollSuggestions, type PollSuggestionsProps } from './PollSuggestions'

const suggestion = (index: number, over: Partial<PollSuggestion> = {}): PollSuggestion => ({
  index,
  question: `Question ${index}?`,
  options: ['Yes', 'No'],
  source: {
    documentName: 'handbook.pdf',
    location: { kind: 'page', number: 4 },
    text: 'Refunds take <b>five</b> days.',
  },
  ...over,
})

const result = (over: Partial<PollSuggestionsResult> = {}): PollSuggestionsResult => ({
  jobId: '11111111-1111-4111-8111-111111111111',
  status: 'SUCCEEDED',
  errorCode: null,
  message: null,
  outcome: 'READY',
  suggestions: [suggestion(1), suggestion(2), suggestion(3)],
  ...over,
})

const render = (over: Partial<PollSuggestionsProps> = {}): string =>
  renderToStaticMarkup(
    <PollSuggestions
      result={null}
      loading={false}
      requesting={false}
      error={null}
      dismissed={new Set()}
      onRequest={() => undefined}
      onDismiss={() => undefined}
      onUse={() => undefined}
      {...over}
    />,
  )

describe('poll suggestions', () => {
  it('each suggestion names its source file only, not the passage text or page', () => {
    const html = render({ result: result() })
    expect(html).toContain('Source: handbook.pdf')
    expect(html).not.toContain('Page 4')
    expect(html).not.toContain('Refunds take')
    expect(html).toContain('Use this')
    expect(html).toContain('Dismiss')
  })

  it('a suggestion can be used to fill the poll form', () => {
    const onUse = vi.fn()
    const html = renderToStaticMarkup(
      <CreatePollForm
        pending={false}
        onSubmit={() => undefined}
        initialValues={{ question: 'Question 1?', options: ['Yes', 'No', 'Maybe'] }}
      />,
    )
    expect(html).toContain('value="Question 1?"')
    expect(html).toContain('value="Maybe"')
    expect(onUse).not.toHaveBeenCalled()
  })

  it('nothing is created until the presenter presses Create', () => {
    const onSubmit = vi.fn()
    renderToStaticMarkup(
      <CreatePollForm
        pending={false}
        onSubmit={onSubmit}
        initialValues={{ question: 'Question 1?', options: ['Yes', 'No'] }}
      />,
    )
    const html = render({ result: result() })
    expect(onSubmit).not.toHaveBeenCalled()
    // The panel offers no create action of its own.
    expect(html).not.toContain('Create poll')
  })

  it('a form without suggestion values starts empty', () => {
    const html = renderToStaticMarkup(<CreatePollForm pending={false} onSubmit={() => undefined} />)
    expect(html).not.toContain('value="Question')
  })

  it('the no-ideas message says to write the poll by hand', () => {
    const html = render({ result: result({ outcome: 'NONE', suggestions: [] }) })
    expect(html).toContain('No poll ideas were found in your documents.')
    expect(html).toContain('write the poll by hand.')
  })

  it('the AI-off message tells the presenter to turn AI on', () => {
    const html = render({ error: { code: 'AI_OFF_FOR_SESSION', message: 'x' } })
    expect(html).toContain('Turn AI on for this session to get poll ideas.')
  })

  it('with AI off, the idle panel says so and Suggest polls is disabled', () => {
    const html = render({ aiOff: true })
    expect(html).toContain('Turn AI on for this session to get poll ideas.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[\s\S]*Suggest polls/)
  })

  it('the budget message says the session used its AI budget', () => {
    const html = render({ error: { code: 'AI_BUDGET_EXHAUSTED', message: 'x' } })
    expect(html).toContain('This session has used its AI budget. Write the poll by hand.')
  })

  it('a failure shows a plain message with a retry', () => {
    const html = render({ error: { code: 'INTERNAL', message: 'boom' } })
    expect(html).toContain('We could not get poll ideas.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('boom')
  })

  it('shows progress while ideas are being found', () => {
    const html = render({ requesting: true })
    expect(html).toContain('Finding poll ideas…')
    expect(html).toContain('role="status"')
  })

  it('the used suggestion is hidden in the browser only', () => {
    const html = render({ result: result(), dismissed: new Set([2]) })
    expect(html).not.toContain('Question 2?')
    expect(html).toContain('Question 1?')
    expect(html).toContain('Question 3?')
    // After a reload nothing is dismissed, so all three return.
    expect(render({ result: result() })).toContain('Question 2?')
  })
})
