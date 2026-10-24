'use client'

import { useState, type FormEvent } from 'react'
import type { ParticipantWordPrompt as ParticipantWordPromptData } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
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
  'rounded px-4 py-2 font-medium focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700'

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
        <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
        <div className="h-14 w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-3">
        <StatusMessage kind="error">{loadError ?? 'We could not load the question.'}</StatusMessage>
        <div>
          <button type="button" onClick={onRetry} className={`${buttonClass} bg-blue-700 text-white`}>
            Try again
          </button>
        </div>
      </div>
    )
  }
  if (!prompt) {
    return <p className="text-left">No word question is open right now.</p>
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
      <h2 id="word-prompt-question" className="text-2xl font-bold break-words">
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
            className="min-h-14 w-full rounded border-2 border-slate-500 px-4 py-3 text-lg focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 disabled:bg-slate-50 disabled:text-slate-700"
          />
          {answered ? null : (
            <p id="word-input-count" className="text-sm text-slate-700">
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
              className="min-h-14 rounded bg-blue-700 px-6 py-3 text-lg font-medium text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 disabled:bg-slate-400"
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
