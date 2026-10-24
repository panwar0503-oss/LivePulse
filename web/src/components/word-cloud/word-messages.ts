// Server error codes mapped to plain words.
const MESSAGES: Record<string, string> = {
  PROMPT_LIMIT_REACHED: 'This session has reached its limit of word clouds.',
  PROMPT_NOT_DRAFT: 'This question was already opened.',
  SESSION_ENDED: 'This session has ended.',
  PROMPT_NOT_ACTIVE: 'This question is closed.',
  VALIDATION_ERROR: 'Check the highlighted fields and try again.',
}

export const wordPromptErrorMessage = (code: string, fallback = 'Something went wrong. Try again.'): string =>
  MESSAGES[code] ?? fallback

export const submitWordErrorMessage = (code: string, fieldMessage?: string): string => {
  if (code === 'WORD_ALREADY_SUBMITTED') return 'You already sent a word. It is shown below.'
  if (code === 'PROMPT_NOT_ACTIVE') return 'This question is closed.'
  return fieldMessage ?? 'We could not send your word. Try again.'
}
