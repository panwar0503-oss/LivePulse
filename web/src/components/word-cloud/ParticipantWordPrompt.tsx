'use client'

import { useState, type FormEvent } from 'react'
import type { ParticipantWordPrompt as ParticipantWordPromptData } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
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

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

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
    return (
      <div role="status" aria-label="Loading word cloud question" className="flex flex-col gap-3">
        <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <StatusMessage kind="error">{loadError ?? 'We could not load the question.'}</StatusMessage>
        <div>
          <button
            type="button"
            onClick={onRetry}
            className={`${buttonClass} bg-brand-600 text-white enabled:hover:bg-brand-700`}
          >
            Try again
          </button>
        </div>
      </div>
    )
  }
  if (!prompt) {
    return <EmptyState>No word question is open right now.</EmptyState>
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
    <section aria-labelledby="word-prompt-question" className="flex flex-col gap-4 text-left">
      <h2 id="word-prompt-question" className="text-xl font-semibold tracking-tight break-words">
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
            className="min-h-14 w-full rounded-xl border-2 border-slate-500 bg-white px-4 py-3 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-50 disabled:text-muted"
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
              className="min-h-11 rounded-xl bg-brand-600 transition-colors duration-150 enabled:hover:bg-brand-700 motion-reduce:transition-none px-5 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-400"
            >
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
