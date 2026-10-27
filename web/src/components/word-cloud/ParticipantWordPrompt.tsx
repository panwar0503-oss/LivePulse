'use client'

import { useState, type FormEvent } from 'react'
import type { ParticipantWordPrompt as ParticipantWordPromptData } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { button, inputLargeClass, motionIn } from '../ui/styles'
import { WordCloud } from './WordCloud'

export type ParticipantWordPromptProps = {
  prompt: ParticipantWordPromptData | null
  status: 'loading' | 'ready' | 'error'
  loadError?: string
  onRetry: () => void
  pending: boolean
  submitError?: string
  onSubmit: (text: string) => void
}

const WORD_MAX = 30

export function ParticipantWordPrompt({
  prompt,
  status,
  loadError,
  onRetry,
  pending,
  submitError,
  onSubmit,
}: ParticipantWordPromptProps) {
  const [text, setText] = useState('')

  if (status === 'loading') {
    return <LoadingState label="Loading word cloud question" rows={2} />
  }
  if (status === 'error') {
    return <ErrorState message={loadError ?? 'We could not load the question.'} onRetry={onRetry} />
  }
  if (!prompt) {
    return <EmptyState icon="chart" title="No question yet">No word question is open right now.</EmptyState>
  }

  const closed = prompt.status === 'CLOSED'
  const answered = prompt.myWord !== null
  // A hidden cloud arrives as null and is never rendered.
  const cloud = prompt.showCloud ? prompt.cloud : null

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (text.trim() !== '') onSubmit(text)
  }

  return (
    <section aria-labelledby="word-prompt-question" className={`flex flex-col gap-4 text-left ${motionIn}`}>
      <h2 id="word-prompt-question" className="text-lg font-semibold tracking-tight break-words">
        {prompt.question}
      </h2>

      {submitError ? <StatusMessage kind="error">{submitError}</StatusMessage> : null}
      {closed ? <StatusMessage kind="info">This question is closed.</StatusMessage> : null}

      {!closed || answered ? (
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
          <label htmlFor="word-input" className="font-medium">
            Your word or short phrase
          </label>
          <input
            id="word-input"
            name="text"
            type="text"
            maxLength={WORD_MAX}
            autoComplete="off"
            disabled={pending || answered || closed}
            value={answered ? (prompt.myWord ?? '') : text}
            onChange={(e) => setText(e.target.value)}
            aria-describedby="word-input-count"
            className={inputLargeClass}
          />
          {answered ? null : (
            <p id="word-input-count" className="text-sm text-muted">
              {text.length}/{WORD_MAX} characters
            </p>
          )}
          {answered ? (
            <p id="word-input-count" role="status" className="font-medium">
              Your word is in.
            </p>
          ) : (
            <button
              type="submit"
              disabled={pending || closed}
              className={button('primary')}
            >
              <Icon name="send" />
              {pending ? 'Sending…' : 'Send'}
            </button>
          )}
        </form>
      ) : null}

      {cloud ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{closed ? 'Final cloud' : 'Live cloud'}</h3>
          <WordCloud cloud={cloud} />
        </div>
      ) : null}
    </section>
  )
}
