'use client'

import { useState } from 'react'
import type { PatchQuestionBody } from '@livepulse/shared'
import { usePresenterQuestions } from '../../hooks/use-presenter-questions'
import { useQnaCopilot } from '../../hooks/use-qna-copilot'
import { ClustersPanel } from './ClustersPanel'
import { CopilotReview } from './CopilotReview'
import { moderateQuestion, setQnaOpen } from '../../lib/api/questions'
import { qnaErrorMessage } from './qna-messages'
import { QnaPanel } from './QnaPanel'

export type PresenterQnaProps = { sessionId: string }

// Connects the Q&A panel to the API; every change is re-read so the list matches the server.
export function PresenterQna({ sessionId }: PresenterQnaProps) {
  const { questions, qnaOpen, status, refresh, error } = usePresenterQuestions(sessionId)
  const [switchPending, setSwitchPending] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | undefined>()
  const [answerError, setAnswerError] = useState<{ questionId: string; message: string } | null>(null)

  const toggle = async (open: boolean): Promise<void> => {
    setSwitchPending(true)
    setActionError(undefined)
    const result = await setQnaOpen(sessionId, open)
    setSwitchPending(false)
    if (!result.ok) setActionError(qnaErrorMessage(result.code, result.message))
    refresh()
  }

  const act = async (questionId: string, patch: PatchQuestionBody, isAnswer = false): Promise<void> => {
    setBusyId(questionId)
    setActionError(undefined)
    setAnswerError(null)
    const result = await moderateQuestion(questionId, patch)
    setBusyId(null)
    if (!result.ok) {
      const message = qnaErrorMessage(result.code, result.fields?.answerText ?? result.message)
      if (isAnswer) setAnswerError({ questionId, message })
      else setActionError(message)
    }
    refresh()
  }

  const copilot = useQnaCopilot(sessionId)
  const questionTexts = new Map(questions.map((q) => [q.id, q.text]))

  return (
    <div className="flex flex-col gap-6">
      <CopilotReview
        status={copilot.status}
        held={copilot.review.held}
        drafts={copilot.review.drafts}
        error={copilot.error}
        busyId={copilot.busyId}
        onApprove={copilot.approve}
        onReject={copilot.reject}
        onRelease={copilot.release}
        onRejectHeld={copilot.rejectHeld}
        onRetry={copilot.retry}
      />
      <ClustersPanel clusters={copilot.clusters} questionTexts={questionTexts} />
      <QnaPanel
        questions={questions}
        qnaOpen={qnaOpen}
        status={status}
        loadError={error?.message}
        onRetry={refresh}
        switchPending={switchPending}
        onToggleQna={(open) => void toggle(open)}
        busyQuestionId={busyId}
        actionError={actionError}
        answerErrorFor={answerError}
        onPin={(id, pinned) => void act(id, { pinned })}
        onHide={(id, hidden) => void act(id, { hidden })}
        onAnswered={(id, answered) => void act(id, { answered })}
        onSaveAnswer={(id, text) => void act(id, { answerText: text }, true)}
        onClearAnswer={(id) => void act(id, { answerText: null }, true)}
      />
    </div>
  )
}
