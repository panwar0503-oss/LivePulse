'use client'

import { useCallback } from 'react'
import type { ParticipantQuestion } from '@livepulse/shared'
import { listParticipantQuestions } from '../lib/api/questions'
import { useQnaSnapshot, type UseQuestionsResult } from './use-qna-snapshot'

export const useParticipantQuestions = (roomCode: string): UseQuestionsResult<ParticipantQuestion> => {
  const load = useCallback(() => listParticipantQuestions(roomCode), [roomCode])
  return useQnaSnapshot({ role: 'participant', roomCode }, load)
}
