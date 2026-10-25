'use client'

import { useState, type FormEvent } from 'react'
import type { ParticipantQuestion } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { upvotesText } from './QnaPanel'

export type ParticipantQnaProps = {
  questions: ParticipantQuestion[]
  qnaOpen: boolean
  status: 'loading' | 'ready' | 'error'
  loadError?: string
  onRetry: () => void
  asking: boolean
  askError?: string
  upvotingId?: string | null
  upvoteError?: string
  // Resolves true when the question was stored, so the box can clear.
  onAsk: (text: string) => Promise<boolean>
  onUpvote: (questionId: string) => void
}

const QUESTION_MAX = 200

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

export function ParticipantQna({
  questions,
  qnaOpen,
  status,
  loadError,
  onRetry,
  asking,
  askError,
  upvotingId = null,
  upvoteError,
  onAsk,
  onUpvote,
}: ParticipantQnaProps) {
  const [text, setText] = useState('')
  const [justAsked, setJustAsked] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (text.trim() === '') return
    setJustAsked(false)
    void onAsk(text).then((stored) => {
      if (stored) {
        setText('')
        setJustAsked(true)
      }
    })
  }

  return (
    <section aria-labelledby="qna-heading" className="flex flex-col gap-4 text-left">
      <h2 id="qna-heading" className="sr-only">
        Questions
      </h2>

      {!qnaOpen ? <StatusMessage kind="info">Q&amp;A is paused by the presenter.</StatusMessage> : null}
      {askError ? <StatusMessage kind="error">{askError}</StatusMessage> : null}
      {upvoteError ? <StatusMessage kind="error">{upvoteError}</StatusMessage> : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-3">
        <label htmlFor="question-input" className="font-medium">
          Ask a question
        </label>
        <input
          id="question-input"
          name="text"
          type="text"
          maxLength={QUESTION_MAX}
          autoComplete="off"
          disabled={asking || !qnaOpen}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setJustAsked(false)
          }}
          aria-describedby="question-input-count"
          className="min-h-14 w-full rounded-xl border-2 border-slate-500 bg-white px-4 py-3 text-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-50 disabled:text-muted"
        />
        <p id="question-input-count" className="text-sm text-muted">
          {text.length}/{QUESTION_MAX} characters
        </p>
        <button
          type="submit"
          disabled={asking || !qnaOpen}
          className="min-h-11 rounded-xl bg-brand-600 transition-colors duration-150 enabled:hover:bg-brand-700 motion-reduce:transition-none px-5 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-400"
        >
          {asking ? 'Sending…' : 'Ask'}
        </button>
        {justAsked ? (
          <p role="status" className="font-medium">
            Your question is in.
          </p>
        ) : null}
      </form>

      {status === 'loading' ? (
        <div role="status" aria-label="Loading questions" className="flex flex-col gap-3">
          <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
          <div className="h-14 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{loadError ?? 'We could not load the questions.'}</StatusMessage>
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
      ) : null}

      {status === 'ready' && questions.length === 0 ? (
        <EmptyState>No questions yet. Be the first to ask.</EmptyState>
      ) : null}

      {status === 'ready' && questions.length > 0 ? (
        <>
          <p aria-live="polite" aria-atomic="true" className="text-sm text-muted">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </p>
          <ul className="flex flex-col gap-3">
            {questions.map((q) => (
              <li
                key={q.id}
                className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 ${q.pinned ? 'border-2 border-brand-600' : 'border-line'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {q.pinned ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-muted">
                      Pinned
                    </span>
                  ) : null}
                  {q.answered ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-muted">
                      Answered
                    </span>
                  ) : null}
                  {q.mine ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
                      Your question
                    </span>
                  ) : null}
                </div>
                <p className="text-lg font-semibold break-words">{q.text}</p>
                {q.answerText ? (
                  <div className="rounded-xl border-l-4 border-brand-600 bg-brand-50 p-3">
                    <p className="text-sm font-semibold text-brand-700">Answer from the presenter</p>
                    <p className="break-words text-slate-900">{q.answerText}</p>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="font-medium text-muted">{upvotesText(q.upvotes)}</span>
                  {q.mine ? null : q.myUpvote ? (
                    <button
                      type="button"
                      disabled
                      className="flex min-h-14 items-center gap-2 rounded-xl border-2 border-brand-600 bg-brand-50 px-6 py-3 text-lg font-semibold text-brand-700"
                    >
                      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
                        <path d="M7.7 14.3 3.9 10.5l1.4-1.4 2.4 2.4 7-7 1.4 1.4z" />
                      </svg>
                      Upvoted
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={!qnaOpen || upvotingId === q.id}
                      onClick={() => onUpvote(q.id)}
                      className="min-h-11 rounded-xl bg-brand-600 transition-colors duration-150 enabled:hover:bg-brand-700 motion-reduce:transition-none px-5 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-400"
                    >
                      Upvote
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
