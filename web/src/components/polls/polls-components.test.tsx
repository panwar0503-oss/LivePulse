import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ParticipantPoll as ParticipantPollData, PresenterPoll } from '@livepulse/shared'
import { CreatePollForm } from './CreatePollForm'
import { ParticipantPoll } from './ParticipantPoll'
import { PollResults } from './PollResults'
import { PollsPanel } from './PollsPanel'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const options = [
  { id: A, label: 'Tea', position: 0 },
  { id: B, label: 'Coffee', position: 1 },
]
const results = {
  total: 3,
  version: 1,
  options: [
    { id: A, count: 2, pct: 66.67 },
    { id: B, count: 1, pct: 33.33 },
  ],
}
const participantPoll: ParticipantPollData = {
  id: '33333333-3333-4333-8333-333333333333',
  question: 'Tea or coffee?',
  status: 'ACTIVE',
  showResults: true,
  closedAt: null,
  options,
  myOptionId: null,
  results,
}
const presenterPoll: PresenterPoll = { ...participantPoll, showResults: true, results }

const noop = (): void => undefined
const participantProps = { status: 'ready', onRetry: noop, pending: false, onVote: noop } as const
const panelProps = {
  status: 'ready',
  onRetry: noop,
  createPending: false,
  onCreate: noop,
  onStart: noop,
  onClose: noop,
  onToggleResults: noop,
} as const

describe('poll components', () => {
  it('shows the open poll with its options as large buttons', () => {
    const html = renderToStaticMarkup(<ParticipantPoll {...participantProps} poll={participantPoll} />)
    expect(html).toContain('Tea or coffee?')
    expect(html).toContain('min-h-14')
    expect(html).toContain('w-full')
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).not.toContain('disabled=""')
  })

  it('shows counts and percentages with the word votes', () => {
    const html = renderToStaticMarkup(<PollResults options={options} results={results} />)
    expect(html).toContain('2 · 67%')
    expect(html).toContain('1 · 33%')
    expect(html).toContain('3 votes')
  })

  it('shows no counts to a participant when results are hidden', () => {
    const html = renderToStaticMarkup(
      <ParticipantPoll
        {...participantProps}
        poll={{ ...participantPoll, showResults: false, results: null }}
      />,
    )
    expect(html).not.toContain('%')
    expect(html).not.toContain('votes')
    expect(html).not.toContain('Live results')
  })

  it('shows the closed message and final results only when results are shown', () => {
    const closed = { ...participantPoll, status: 'CLOSED' as const, closedAt: '2026-01-01T00:00:00.000Z' }
    const shown = renderToStaticMarkup(<ParticipantPoll {...participantProps} poll={closed} />)
    expect(shown).toContain('This poll is closed.')
    expect(shown).toContain('Final results')
    const hidden = renderToStaticMarkup(
      <ParticipantPoll {...participantProps} poll={{ ...closed, showResults: false, results: null }} />,
    )
    expect(hidden).toContain('This poll is closed.')
    expect(hidden).not.toContain('Final results')
    expect(hidden).not.toContain('%')
  })

  it('shows Your vote is recorded after a vote and disables the other options', () => {
    const html = renderToStaticMarkup(
      <ParticipantPoll {...participantProps} poll={{ ...participantPoll, myOptionId: A }} />,
    )
    expect(html).toContain('Your vote is recorded.')
    expect(html).toContain('Your answer')
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })

  it('refuses to show a count bar without its label', () => {
    const html = renderToStaticMarkup(
      <PollResults options={[{ id: A, label: 'Tea', position: 0 }]} results={results} />,
    )
    expect(html).toContain('Tea')
    expect(html).not.toContain('Coffee')
    expect(html.match(/width:/g)).toHaveLength(1)
  })

  it('keeps the results region polite and the bars hidden from assistive technology', () => {
    const html = renderToStaticMarkup(<PollResults options={options} results={results} />)
    expect(html).toContain('aria-live="polite"')
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(2)
    expect(html).toContain('motion-reduce:transition-none')
  })

  it('shows the empty state when no poll has been created', () => {
    const html = renderToStaticMarkup(<PollsPanel {...panelProps} polls={[]} />)
    expect(html).toContain('No polls yet. Create your first poll.')
  })

  it('tells the presenter to close the open poll before starting a draft', () => {
    const draft = { ...presenterPoll, id: B, status: 'DRAFT' as const }
    const html = renderToStaticMarkup(
      <PollsPanel {...panelProps} polls={[{ ...presenterPoll, status: 'ACTIVE' }, draft]} />,
    )
    expect(html).toContain('Another poll is open. Close it first.')
    expect(html).toContain('Close poll')
    expect(html).toContain('Show results to participants')
  })

  it('offers a retry when the polls cannot be loaded', () => {
    const html = renderToStaticMarkup(<PollsPanel {...panelProps} status="error" polls={[]} />)
    expect(html).toContain('Try again')
    expect(html).not.toContain('No polls yet')
  })

  it('links poll form errors to their fields and keeps two options minimum', () => {
    const html = renderToStaticMarkup(
      <CreatePollForm
        pending={false}
        fieldErrors={{ question: 'Question must be 1–200 characters.' }}
        onSubmit={noop}
      />,
    )
    expect(html).toContain('aria-describedby="poll-question-count poll-question-error"')
    expect(html).toContain('0/200 characters')
    expect(html.match(/Remove/g)).toHaveLength(2)
    expect(html.match(/disabled=""/g)).toHaveLength(2)
  })
})
