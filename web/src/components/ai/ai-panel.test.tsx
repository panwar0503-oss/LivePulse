import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { AiState } from '@livepulse/shared'
import { AiPanelView, type AiPanelViewProps } from './AiPanel'

const aiState = (over: Partial<AiState> = {}): AiState => ({
  enabled: false,
  globalEnabled: true,
  provider: 'fake',
  usage: { tokensUsed: 0, tokenBudget: 200000 },
  recentFailures: [],
  ...over,
})

const render = (state: AiState | null, over: Partial<AiPanelViewProps> = {}): string =>
  renderToStaticMarkup(
    <AiPanelView
      state={state}
      status="ready"
      pending={false}
      error={null}
      diagnosticQueued={false}
      onToggle={() => undefined}
      onDiagnostic={() => undefined}
      onRetry={() => undefined}
      {...over}
    />,
  )

const button = (html: string, label: string): string => {
  const match = html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}`, 's'))
  return match?.[0] ?? ''
}

describe('AI panel', () => {
  it('AI panel shows AI off with the switch available', () => {
    const html = render(aiState())
    expect(html).toContain('AI is off for this session.')
    expect(html).toContain('role="switch"')
    expect(html).toContain('aria-checked="false"')
    expect(html).not.toMatch(/<button[^>]*role="switch"[^>]*disabled=""/)
  })

  it('AI panel shows AI on with the audience text notice', () => {
    expect(render(aiState({ enabled: true }))).toContain(
      'AI is on. Audience text may be processed by an AI provider.',
    )
  })

  it('AI panel shows the global off message and disables the switch', () => {
    const html = render(aiState({ globalEnabled: false }))
    expect(html).toContain('AI is turned off for this server.')
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*disabled=""/)
  })

  it('AI panel shows usage as tokens used of budget', () => {
    const html = render(aiState({ usage: { tokensUsed: 1200, tokenBudget: 200000 } }))
    expect(html).toContain('1,200 of 200,000 tokens used')
  })

  it('AI panel lists a safe failure message without provider text', () => {
    const html = render(
      aiState({
        recentFailures: [
          {
            jobId: '00000000-0000-4000-8000-000000000001',
            type: 'PING',
            taskName: 'Diagnostic check',
            errorCode: 'PROVIDER_TIMEOUT',
            message: 'sk-secret provider stack trace <b>boom</b>',
            failedAt: '2026-10-24T10:00:00.000Z',
          },
        ],
      }),
    )
    expect(html).toContain('An AI task failed. Try again later.')
    expect(html).toContain('Diagnostic check')
    expect(html).toContain('The AI service took too long to respond.')
    expect(html).not.toContain('sk-secret')
    expect(html).not.toContain('<b>')
  })

  it('AI panel shows no failures when there are none', () => {
    expect(render(aiState())).toContain('No AI failures.')
  })

  it('AI panel disables the diagnostic button while AI is off', () => {
    expect(button(render(aiState()), 'Run diagnostic')).toContain('disabled=""')
    expect(button(render(aiState({ enabled: true })), 'Run diagnostic')).not.toContain('disabled=""')
  })

  it('AI panel shows a loading state and an error with retry', () => {
    expect(render(null, { status: 'loading' })).toContain('Loading AI settings')
    const html = render(null, { status: 'error', error: 'Could not reach LivePulse.' })
    expect(html).toContain('Could not reach LivePulse.')
    expect(html).toContain('Try again')
  })
})
