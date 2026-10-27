'use client'

import { useState, type FormEvent } from 'react'
import type { ParticipantQuestion } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { LoadingState } from '../ui/LoadingState'
import { ScrollArea } from '../ui/ScrollArea'
import { badgeClass, button, hintClass, inputLargeClass } from '../ui/styles'
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

// Only the viewer's own row carries a status; other rows never show one.
export const ownStatusText = (status: ParticipantQuestion['status']): string | null => {
  if (status === 'CHECKING') return 'Checking…'
  if (status === 'MERGED') return 'Similar question already asked — upvoted it.'
  return null
}

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
          className={inputLargeClass}
        />
        <p id="question-input-count" className={hintClass}>
          {text.length}/{QUESTION_MAX} characters
        </p>
        <button
          type="submit"
          disabled={asking || !qnaOpen}
          className={button('primary')}
        >
          {asking ? 'Sending…' : 'Ask'}
        </button>
        {justAsked ? (
          <p role="status" className="font-medium">
            Your question is in.
          </p>
        ) : null}
      </form>

      {status === 'loading' ? <LoadingState label="Loading questions…" rows={2} /> : null}

      {status === 'error' ? (
        <ErrorState message={loadError ?? 'We could not load the questions.'} onRetry={onRetry} />
      ) : null}

      {status === 'ready' && questions.length === 0 ? (
        <EmptyState icon="users">No questions yet. Be the first to ask.</EmptyState>
      ) : null}

      {status === 'ready' && questions.length > 0 ? (
        <>
          <p aria-live="polite" aria-atomic="true" className="text-sm text-muted">
            {questions.length} {questions.length === 1 ? 'question' : 'questions'}
          </p>
          <ScrollArea label="Questions list" maxHeightClass="max-h-[40rem]">
          <ul className="flex flex-col gap-3">
            {questions.map((q) => (
              <li
                key={q.id}
                className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 ${q.pinned ? 'border-2 border-brand-600' : 'border-line'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {q.pinned ? (
                    <span className={badgeClass}>
                      Pinned
                    </span>
                  ) : null}
                  {q.answered ? (
                    <span className={badgeClass}>
                      Answered
                    </span>
                  ) : null}
                  {q.mine ? (
                    <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
                      Your question
                    </span>
                  ) : null}
                </div>
                <p className="text-base font-semibold break-words">{q.text}</p>
                {q.mine && ownStatusText(q.status) ? (
                  <p role="status" className="text-sm text-muted">
                    {ownStatusText(q.status)}
                  </p>
                ) : null}
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
                      className="flex min-h-12 items-center gap-2 rounded-xl border-2 border-brand-600 bg-brand-50 px-5 py-3 text-base font-semibold text-brand-700"
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
                      className={button('primary')}
                    >
                      Upvote
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          </ScrollArea>
        </>
      ) : null}
    </section>
  )
}
