// Server error codes mapped to plain words. Unknown codes fall back to the server's own message.
const MESSAGES: Record<string, string> = {
  QNA_CLOSED: 'Q&A is paused by the presenter.',
  SESSION_ENDED: 'This session has ended.',
  QUESTION_LIMIT_REACHED: 'You have asked the most questions allowed in this session.',
  QUESTION_ALREADY_ASKED: 'You already asked that question.',
  UPVOTE_ALREADY_RECORDED: 'You already upvoted this question.',
  OWN_QUESTION: 'You cannot upvote your own question.',
  QUESTION_HIDDEN: 'That question is no longer available.',
  QUESTION_PIN_CONFLICT: 'Another question was pinned at the same moment. Check the list and try again.',
  DRAFT_NOT_PENDING: 'This draft was already handled.',
  QUESTION_ALREADY_ANSWERED: 'This question was already answered.',
  QUESTION_NOT_VISIBLE: 'This question is no longer visible.',
  QUESTION_NOT_HELD: 'This question was already handled.',
  PARTICIPANT_AUTH_REQUIRED: 'Join the session again to ask or upvote.',
}

export const qnaErrorMessage = (code: string, fallback = 'Something went wrong. Try again.'): string =>
  MESSAGES[code] ?? fallback
