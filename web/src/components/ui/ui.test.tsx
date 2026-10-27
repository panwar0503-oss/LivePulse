import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { StatusMessage } from '../sessions/StatusMessage'
import { AudienceCount } from './AudienceCount'
import { ConnectionStatus } from './ConnectionStatus'
import { EmptyState } from './EmptyState'
import { ErrorState } from './ErrorState'
import { ScrollArea } from './ScrollArea'
import { StatusPill, type StatusTone } from './StatusPill'

describe('StatusPill', () => {
  it.each(['live', 'reconnecting', 'disconnected', 'ended'] as const satisfies readonly StatusTone[])(
    'shows an icon and its label for the %s state',
    (tone) => {
      const html = renderToStaticMarkup(<StatusPill tone={tone}>Label text</StatusPill>)
      expect(html).toContain('<svg')
      expect(html).toContain('Label text')
    },
  )
})

describe('StatusMessage', () => {
  it('keeps its text prefix next to the icon', () => {
    const html = renderToStaticMarkup(<StatusMessage kind="error">Nope</StatusMessage>)
    expect(html).toContain('Error: ')
    expect(html).toContain('<svg')
  })
})

describe('EmptyState', () => {
  it('shows its title and icon', () => {
    const html = renderToStaticMarkup(
      <EmptyState icon="users" title="No questions yet">
        Ask the first one.
      </EmptyState>,
    )
    expect(html).toContain('No questions yet')
    expect(html).toContain('<svg')
    expect(html).toContain('Ask the first one.')
  })
})

describe('ErrorState', () => {
  it('offers Try again only when a retry is possible', () => {
    const withRetry = renderToStaticMarkup(<ErrorState message="Broke" onRetry={() => undefined} />)
    const without = renderToStaticMarkup(<ErrorState message="Broke" />)
    expect(withRetry).toContain('Try again')
    expect(without).not.toContain('Try again')
    expect(without).toContain('Broke')
  })
})

describe('ScrollArea', () => {
  it('is focusable, labelled, and hides its scrollbar', () => {
    const html = renderToStaticMarkup(<ScrollArea label="Answers">x</ScrollArea>)
    expect(html).toContain('tabindex="0"')
    expect(html).toContain('role="region"')
    expect(html).toContain('aria-label="Answers"')
    expect(html).toContain('scrollbar-none')
  })
})

describe('ConnectionStatus', () => {
  it('announces connection changes politely in one region', () => {
    const html = renderToStaticMarkup(
      <ConnectionStatus status="connected" ended={false} audience="presenter" />,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('Live')
  })

  it('tells a participant to join again, and a presenter to refresh', () => {
    const participant = renderToStaticMarkup(
      <ConnectionStatus status="disconnected" ended={false} audience="participant" />,
    )
    const presenter = renderToStaticMarkup(
      <ConnectionStatus status="disconnected" ended={false} audience="presenter" />,
    )
    expect(participant).toContain('Live updates stopped. Join again to keep watching.')
    expect(presenter).toContain('Live updates stopped. Refresh the page.')
    expect(participant).toContain('Disconnected')
  })
})

describe('AudienceCount', () => {
  it('shows the number of people', () => {
    expect(renderToStaticMarkup(<AudienceCount count={5} audience="presenter" />)).toContain('5 people here')
  })

  it('explains a missing count differently for each audience, without a live region', () => {
    const participant = renderToStaticMarkup(<AudienceCount count={null} audience="participant" />)
    const presenter = renderToStaticMarkup(<AudienceCount count={null} audience="presenter" />)
    expect(participant).toContain('The number of people here is not shown on this screen.')
    expect(presenter).toContain('— Count unavailable right now')
    for (const html of [participant, presenter]) {
      expect(html).not.toContain('aria-live')
      expect(html).not.toContain('role="status"')
    }
  })
})
