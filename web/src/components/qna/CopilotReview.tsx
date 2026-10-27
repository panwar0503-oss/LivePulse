'use client'

import { useState } from 'react'
import { QNA_COPILOT_LIMITS, type HeldQuestion, type ReviewDraft } from '@livepulse/shared'
import { approveBody } from '../../lib/api/qna-copilot-client'
import { locationLabel } from '../knowledge/KnowledgeResults'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { ScrollArea } from '../ui/ScrollArea'
import { button, hintClass, inputClass, itemCardClass, labelClass } from '../ui/styles'
import { qnaErrorMessage } from './qna-messages'

export const NOT_COVERED_MESSAGE = 'Not covered in the materials'

export type CopilotReviewProps = {
  status: 'loading' | 'ready' | 'error'
  held: HeldQuestion[]
  drafts: ReviewDraft[]
  error: { code: string; message: string } | null
  busyId: string | null
  onApprove: (draftId: string, text?: string) => void
  onReject: (draftId: string) => void
  onRelease: (questionId: string) => void
  onRejectHeld: (questionId: string) => void
  onRetry: () => void
}

export const confidenceNote = (confidence: number | null): string | null => {
  if (confidence === null) return null
  const level = confidence >= 0.75 ? 'High' : confidence >= 0.5 ? 'Medium' : 'Low'
  return `${level} confidence. Check the answer against the sources before approving.`
}

type DraftCardProps = {
  draft: ReviewDraft
  busy: boolean
  onApprove: CopilotReviewProps['onApprove']
  onReject: CopilotReviewProps['onReject']
}

// Text below is rendered as plain React text; draft and question text are never interpreted as HTML.
function DraftCard({ draft, busy, onApprove, onReject }: DraftCardProps) {
  const [text, setText] = useState(draft.text ?? '')
  const inputId = `draft-text-${draft.id}`
  const note = confidenceNote(draft.confidence)

  return (
    <li className={itemCardClass}>
      <p className="font-semibold break-words">{draft.questionText}</p>

      {draft.status === 'DRAFTING' ? (
        <p role="status" className={hintClass}>
          Drafting an answer…
        </p>
      ) : draft.outcome === 'NOT_COVERED' ? (
        <>
          <p className="font-medium">{NOT_COVERED_MESSAGE}</p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(draft.id)}
              className={button('secondary')}
            >
              <Icon name="x" />
              Reject<span className="sr-only"> draft for: {draft.questionText}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(draft.id)}
              className={button('primary')}
            >
              <Icon name="file" />
              Write an answer by hand<span className="sr-only"> for: {draft.questionText}</span>
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={inputId} className={labelClass}>
              Draft answer
              <span className="sr-only"> for: {draft.questionText}</span>
            </label>
            <input
              id={inputId}
              type="text"
              maxLength={QNA_COPILOT_LIMITS.maxAnswerChars}
              value={text}
              disabled={busy}
              onChange={(e) => setText(e.target.value)}
              className={inputClass}
            />
            <p className={hintClass}>
              {text.length}/{QNA_COPILOT_LIMITS.maxAnswerChars} characters
            </p>
          </div>

          {note ? <p className={hintClass}>{note}</p> : null}

          {draft.citations.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">Sources</p>
              <ul className="list-disc pl-5 text-sm break-words">
                {draft.citations.map((c, i) => (
                  <li key={i}>
                    {c.documentName} · {locationLabel(c.location)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || text.trim() === ''}
              onClick={() => {
                const body = approveBody(draft.text, text)
                onApprove(draft.id, body.text)
              }}
              className={button('primary')}
            >
              <Icon name="check" />
              Approve<span className="sr-only"> answer for: {draft.questionText}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onReject(draft.id)}
              className={button('secondary')}
            >
              <Icon name="x" />
              Reject<span className="sr-only"> draft for: {draft.questionText}</span>
            </button>
          </div>
        </>
      )}
    </li>
  )
}

export function CopilotReview(props: CopilotReviewProps) {
  const { status, held, drafts, error, busyId } = props
  const empty = status === 'ready' && held.length === 0 && drafts.length === 0

  return (
    <section aria-labelledby="copilot-review-heading" className="flex flex-col gap-3">
      <h3 id="copilot-review-heading" className="font-semibold">
        Needs your review
      </h3>

      {error ? (
        <div role="status">
          <StatusMessage kind="error">{qnaErrorMessage(error.code, error.message)}</StatusMessage>
        </div>
      ) : null}

      {status === 'loading' ? <LoadingState label="Loading questions to review…" rows={1} /> : null}

      {status === 'error' ? (
        <ErrorState message="We could not load the questions to review." onRetry={props.onRetry} />
      ) : null}

      {empty ? <EmptyState icon="check" title="All caught up">Nothing needs review right now.</EmptyState> : null}

      {held.length > 0 ? (
        <ScrollArea label="Held questions list" maxHeightClass="max-h-96">
        <ul aria-label="Held questions" className="flex flex-col gap-3">
          {held.map((q) => (
            <li key={q.questionId} className={itemCardClass}>
              {q.label ? (
                <span className="text-xs font-semibold text-slate-700">Flagged as {q.label}</span>
              ) : null}
              <p className="font-semibold break-words">{q.text}</p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={busyId === q.questionId}
                  onClick={() => props.onRelease(q.questionId)}
                  className={button('primary')}
                >
                  <Icon name="check" />
                  Release<span className="sr-only"> question: {q.text}</span>
                </button>
                <button
                  type="button"
                  disabled={busyId === q.questionId}
                  onClick={() => props.onRejectHeld(q.questionId)}
                  className={button('dangerSecondary')}
                >
                  <Icon name="x" />
                  Reject<span className="sr-only"> question: {q.text}</span>
                </button>
              </div>
            </li>
          ))}
        </ul>
        </ScrollArea>
      ) : null}

      {drafts.length > 0 ? (
        <ScrollArea label="Draft answers list" maxHeightClass="max-h-[32rem]">
        <ul aria-label="Draft answers" className="flex flex-col gap-3">
          {drafts.map((d) => (
            <DraftCard
              key={d.id}
              draft={d}
              busy={busyId === d.id}
              onApprove={props.onApprove}
              onReject={props.onReject}
            />
          ))}
        </ul>
        </ScrollArea>
      ) : null}
    </section>
  )
}
