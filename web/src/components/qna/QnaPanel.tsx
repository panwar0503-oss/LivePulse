'use client'

import type { PresenterQuestion } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { AnswerForm } from './AnswerForm'

export type QnaPanelProps = {
  questions: PresenterQuestion[]
  qnaOpen: boolean
  status: 'loading' | 'ready' | 'error'
  loadError?: string
  onRetry: () => void
  switchPending: boolean
  onToggleQna: (open: boolean) => void
  busyQuestionId?: string | null
  actionError?: string
  answerErrorFor?: { questionId: string; message: string } | null
  onPin: (questionId: string, pinned: boolean) => void
  onHide: (questionId: string, hidden: boolean) => void
  onAnswered: (questionId: string, answered: boolean) => void
  onSaveAnswer: (questionId: string, text: string) => void
  onClearAnswer: (questionId: string) => void
}

export const upvotesText = (count: number): string => `${count} ${count === 1 ? 'upvote' : 'upvotes'}`

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50'
const badgeClass =
  'inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-muted'

type QuestionCardProps = Pick<
  QnaPanelProps,
  'onPin' | 'onHide' | 'onAnswered' | 'onSaveAnswer' | 'onClearAnswer' | 'answerErrorFor'
> & { question: PresenterQuestion; busy: boolean }

function QuestionCard({
  question: q,
  busy,
  answerErrorFor,
  onPin,
  onHide,
  onAnswered,
  onSaveAnswer,
  onClearAnswer,
}: QuestionCardProps) {
  const actionClass = `${buttonClass} border border-slate-300 bg-white enabled:hover:bg-slate-50`
  return (
    <li
      className={`flex flex-col gap-3 rounded-2xl border bg-white p-4 ${q.pinned ? 'border-2 border-brand-600' : 'border-line'}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {q.pinned ? <span className={badgeClass}>Pinned</span> : null}
        {q.answered ? <span className={badgeClass}>Answered</span> : null}
        {q.hidden ? <span className={badgeClass}>Hidden</span> : null}
        <span className="text-sm font-medium text-muted">{upvotesText(q.upvotes)}</span>
      </div>
      <p className="text-lg font-semibold break-words">{q.text}</p>
      {q.answerText ? (
        <p className="break-words text-slate-900">
          <span className="font-semibold">Answer: </span>
          {q.answerText}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" disabled={busy} onClick={() => onPin(q.id, !q.pinned)} className={actionClass}>
          {q.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" disabled={busy} onClick={() => onHide(q.id, !q.hidden)} className={actionClass}>
          {q.hidden ? 'Show' : 'Hide'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswered(q.id, !q.answered)}
          className={actionClass}
        >
          {q.answered ? 'Mark unanswered' : 'Mark answered'}
        </button>
      </div>
      <AnswerForm
        questionId={q.id}
        initialAnswer={q.answerText}
        pending={busy}
        error={answerErrorFor?.questionId === q.id ? answerErrorFor.message : undefined}
        onSave={(text) => onSaveAnswer(q.id, text)}
        onClear={() => onClearAnswer(q.id)}
      />
    </li>
  )
}

export function QnaPanel({
  questions,
  qnaOpen,
  status,
  loadError,
  onRetry,
  switchPending,
  onToggleQna,
  busyQuestionId = null,
  actionError,
  answerErrorFor = null,
  onPin,
  onHide,
  onAnswered,
  onSaveAnswer,
  onClearAnswer,
}: QnaPanelProps) {
  // Server order is kept; the lists are only split by the hidden flag.
  const visible = questions.filter((q) => !q.hidden)
  const hidden = questions.filter((q) => q.hidden)
  const cardProps = { answerErrorFor, onPin, onHide, onAnswered, onSaveAnswer, onClearAnswer }

  return (
    <section aria-labelledby="qna-heading" className="flex flex-col gap-4 text-left">
      <h2 id="qna-heading" className="sr-only">
        Questions
      </h2>

      <div className="flex items-center gap-3">
        <button
          id="qna-switch"
          type="button"
          role="switch"
          aria-checked={qnaOpen}
          disabled={switchPending}
          onClick={() => onToggleQna(!qnaOpen)}
          className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-500 bg-white transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-checked:bg-brand-600 disabled:opacity-50"
        >
          <span
            aria-hidden="true"
            className={`inline-block h-5 w-5 rounded-full bg-slate-600 shadow-sm transition-transform duration-150 motion-reduce:transition-none ${
              qnaOpen ? 'translate-x-6 bg-white' : 'translate-x-1'
            }`}
          />
        </button>
        <label htmlFor="qna-switch">
          Accepting questions <span className="text-sm text-muted">({qnaOpen ? 'On' : 'Off'})</span>
        </label>
      </div>

      {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}

      {status === 'loading' ? (
        <div role="status" aria-label="Loading questions" className="flex flex-col gap-3">
          <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
          <div className="h-24 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
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
        <EmptyState>No questions yet. Participants can ask from their phones.</EmptyState>
      ) : null}

      {status === 'ready' && visible.length > 0 ? (
        <>
          <p aria-live="polite" aria-atomic="true" className="text-sm text-muted">
            {visible.length} {visible.length === 1 ? 'question' : 'questions'}
          </p>
          <ul className="flex flex-col gap-3">
            {visible.map((q) => (
              <QuestionCard key={q.id} question={q} busy={busyQuestionId === q.id} {...cardProps} />
            ))}
          </ul>
        </>
      ) : null}

      {status === 'ready' && hidden.length > 0 ? (
        <div className="flex flex-col gap-3">
          <h3 className="text-base font-semibold">Hidden questions</h3>
          <ul className="flex flex-col gap-3">
            {hidden.map((q) => (
              <QuestionCard key={q.id} question={q} busy={busyQuestionId === q.id} {...cardProps} />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
