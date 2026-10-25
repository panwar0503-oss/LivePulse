'use client'

import { useCallback } from 'react'
import type { PresenterQuestion } from '@livepulse/shared'
import { listPresenterQuestions } from '../lib/api/questions'
import { useQnaSnapshot, type UseQuestionsResult } from './use-qna-snapshot'

export const usePresenterQuestions = (sessionId: string): UseQuestionsResult<PresenterQuestion> => {
  const load = useCallback(() => listPresenterQuestions(sessionId), [sessionId])
  return useQnaSnapshot({ role: 'presenter', sessionId }, load)
}
