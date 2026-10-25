'use client'

import { useState } from 'react'
import { useParticipantQuestions } from '../../hooks/use-participant-questions'
import { askQuestion, upvoteQuestion } from '../../lib/api/questions'
import { qnaErrorMessage } from './qna-messages'
import { ParticipantQna } from './ParticipantQna'

export type LiveParticipantQnaProps = { roomCode: string }

// Connects the Q&A view to the API; a refused action is re-read so the screen shows the stored state.
export function LiveParticipantQna({ roomCode }: LiveParticipantQnaProps) {
  const { questions, qnaOpen, status, refresh, error } = useParticipantQuestions(roomCode)
  const [asking, setAsking] = useState(false)
  const [askError, setAskError] = useState<string | undefined>()
  const [upvotingId, setUpvotingId] = useState<string | null>(null)
  const [upvoteError, setUpvoteError] = useState<string | undefined>()

  const handleAsk = async (text: string): Promise<boolean> => {
    setAsking(true)
    setAskError(undefined)
    const result = await askQuestion(roomCode, text)
    setAsking(false)
    if (!result.ok) setAskError(qnaErrorMessage(result.code, result.fields?.text ?? result.message))
    refresh()
    return result.ok
  }

  const handleUpvote = async (questionId: string): Promise<void> => {
    setUpvotingId(questionId)
    setUpvoteError(undefined)
    const result = await upvoteQuestion(questionId)
    setUpvotingId(null)
    if (!result.ok) setUpvoteError(qnaErrorMessage(result.code, result.message))
    refresh()
  }

  return (
    <ParticipantQna
      questions={questions}
      qnaOpen={qnaOpen}
      status={status}
      loadError={error?.message}
      onRetry={refresh}
      asking={asking}
      askError={askError}
      upvotingId={upvotingId}
      upvoteError={upvoteError}
      onAsk={handleAsk}
      onUpvote={(id) => void handleUpvote(id)}
    />
  )
}
