// Server error codes mapped to plain words; unknown codes fall back to a generic retry message.
const MESSAGES: Record<string, string> = {
  POLL_ALREADY_ACTIVE: 'Another poll is open. Close it first.',
  POLL_LIMIT_REACHED: 'This session has reached its limit of polls.',
  POLL_NOT_DRAFT: 'This poll was already started.',
  POLL_NOT_ACTIVE: 'This poll is closed.',
  VALIDATION_ERROR: 'Check the highlighted fields and try again.',
}

export const pollErrorMessage = (code: string, fallback = 'Something went wrong. Try again.'): string =>
  MESSAGES[code] ?? fallback

export const voteErrorMessage = (code: string): string =>
  code === 'POLL_NOT_ACTIVE' ? 'This poll is closed.' : 'We could not record your vote. Try again.'

export const votesText = (count: number): string => `${count} ${count === 1 ? 'vote' : 'votes'}`
