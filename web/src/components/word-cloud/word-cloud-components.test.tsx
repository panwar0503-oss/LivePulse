import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type {
  ParticipantWordPrompt as PromptData,
  PresenterWordPrompt,
  WordCloud as CloudData,
} from '@livepulse/shared'
import { CreateWordPromptForm } from './CreateWordPromptForm'
import { ParticipantWordPrompt } from './ParticipantWordPrompt'
import { WordCloud } from './WordCloud'
import { WordPromptsPanel } from './WordPromptsPanel'
import { submitWordErrorMessage } from './word-messages'

const cloud: CloudData = {
  total: 6,
  version: 3,
  entries: [
    { key: 'zebra', word: 'Zebra', count: 1 },
    { key: 'apple', word: 'Apple', count: 5 },
  ],
}
const emptyCloud: CloudData = { total: 0, version: 0, entries: [] }

const participantBase = {
  status: 'ready' as const,
  onRetry: () => undefined,
  pending: false,
  onSubmit: () => undefined,
}
const prompt = (over: Partial<PromptData>): PromptData => ({
  id: '11111111-1111-4111-8111-111111111111',
  question: 'One word for today?',
  status: 'ACTIVE',
  showCloud: true,
  closedAt: null,
  myWord: null,
  cloud,
  ...over,
})
const presenterPrompt = (over: Partial<PresenterWordPrompt>): PresenterWordPrompt => ({
  id: '22222222-2222-4222-8222-222222222222',
  question: 'Presenter question',
  status: 'DRAFT',
  showCloud: true,
  closedAt: null,
  cloud: emptyCloud,
  ...over,
})
const panelBase = {
  status: 'ready' as const,
  onRetry: () => undefined,
  createPending: false,
  onCreate: () => undefined,
  onOpen: () => undefined,
  onClose: () => undefined,
  onToggleCloud: () => undefined,
}

describe('word cloud components', () => {
  it('shows the cloud words in the order they were given, never re-sorted', () => {
    const html = renderToStaticMarkup(<WordCloud cloud={cloud} />)
    expect(html.indexOf('Zebra')).toBeGreaterThan(-1)
    expect(html.indexOf('Zebra')).toBeLessThan(html.indexOf('Apple'))
  })

  it('renders a typed <b> tag as plain text inside the cloud', () => {
    const risky: CloudData = {
      total: 1,
      version: 1,
      entries: [{ key: '<b>x</b>', word: '<b>x</b>', count: 1 }],
    }
    const html = renderToStaticMarkup(<WordCloud cloud={risky} />)
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('shows the empty message when no words have been sent', () => {
    expect(renderToStaticMarkup(<WordCloud cloud={emptyCloud} />)).toContain(
      'No words yet. Answers will appear here.',
    )
  })

  it('shows no words to a participant when the cloud is hidden (cloud null)', () => {
    const html = renderToStaticMarkup(
      <ParticipantWordPrompt
        {...participantBase}
        prompt={prompt({ showCloud: false, cloud: null, myWord: 'Hi' })}
      />,
    )
    expect(html).not.toContain('Zebra')
    expect(html).not.toContain('Live cloud')
  })

  it('shows Your word is in and disables the input after a send', () => {
    const html = renderToStaticMarkup(
      <ParticipantWordPrompt {...participantBase} prompt={prompt({ myWord: 'Calm' })} />,
    )
    expect(html).toContain('Your word is in.')
    expect(html).toMatch(/<input[^>]*disabled/)
    expect(html).toContain('value="Calm"')
  })

  it('shows the closed message and the final cloud only when allowed', () => {
    const allowed = renderToStaticMarkup(
      <ParticipantWordPrompt {...participantBase} prompt={prompt({ status: 'CLOSED' })} />,
    )
    expect(allowed).toContain('This question is closed.')
    expect(allowed).toContain('Apple')
    const hidden = renderToStaticMarkup(
      <ParticipantWordPrompt
        {...participantBase}
        prompt={prompt({ status: 'CLOSED', showCloud: false, cloud: null })}
      />,
    )
    expect(hidden).toContain('This question is closed.')
    expect(hidden).not.toContain('Apple')
  })

  it('keeps the cloud region polite and announces the total only', () => {
    const html = renderToStaticMarkup(<WordCloud cloud={cloud} />)
    expect(html.match(/aria-live="polite"/g)).toHaveLength(1)
    const live = /<p aria-live="polite"[^>]*>(.*?)<\/p>/.exec(html)?.[1] ?? ''
    expect(live).toContain('6 answers')
    expect(live).not.toContain('Apple')
  })

  it('shows the open question with a labelled input and a maxLength of 30', () => {
    const html = renderToStaticMarkup(<ParticipantWordPrompt {...participantBase} prompt={prompt({})} />)
    expect(html).toContain('One word for today?')
    expect(html).toContain('for="word-input"')
    expect(html).toContain('maxLength="30"')
    expect(html).toContain('Send')
  })

  it('explains refused sends in plain words', () => {
    expect(submitWordErrorMessage('WORD_ALREADY_SUBMITTED')).toBe(
      'You already sent a word. It is shown below.',
    )
    expect(submitWordErrorMessage('PROMPT_NOT_ACTIVE')).toBe('This question is closed.')
    expect(submitWordErrorMessage('VALIDATION_ERROR', 'Use 30 characters or fewer.')).toBe(
      'Use 30 characters or fewer.',
    )
    expect(submitWordErrorMessage('INTERNAL')).toBe('We could not send your word. Try again.')
  })

  it('shows loading, empty and error states to the presenter', () => {
    expect(renderToStaticMarkup(<WordPromptsPanel {...panelBase} prompts={[]} status="loading" />)).toContain(
      'Loading word clouds',
    )
    expect(renderToStaticMarkup(<WordPromptsPanel {...panelBase} prompts={[]} />)).toContain(
      'No word clouds yet. Create your first question.',
    )
    const failed = renderToStaticMarkup(<WordPromptsPanel {...panelBase} prompts={[]} status="error" />)
    expect(failed).toContain('Try again')
  })

  it('warns that opening a draft closes the question that is open', () => {
    const html = renderToStaticMarkup(
      <WordPromptsPanel
        {...panelBase}
        prompts={[
          presenterPrompt({ status: 'ACTIVE', id: '33333333-3333-4333-8333-333333333333' }),
          presenterPrompt({}),
        ]}
      />,
    )
    expect(html).toContain('Another question is open. Opening this one will close it.')
    expect(html).toContain('Show cloud to participants')
  })

  it('counts the question characters and links field errors to the input', () => {
    const html = renderToStaticMarkup(
      <CreateWordPromptForm
        pending={false}
        fieldErrors={{ question: 'Too short.' }}
        onSubmit={() => undefined}
      />,
    )
    expect(html).toContain('0/200 characters')
    expect(html).toContain('aria-describedby="word-question-count word-question-error"')
    expect(html).toContain('Too short.')
  })
})
