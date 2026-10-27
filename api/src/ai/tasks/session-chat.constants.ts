import { REPORT_LIMITS } from '@livepulse/shared'

// Tokens kept free for the system prompt, tool results and the answer, so the context never overflows.
export const CHAT_RESERVE_TOKENS = 8000
// Upper bound on model-tool round trips per question, so a looping model cannot run forever.
export const CHAT_MAX_ROUNDS = 4
// Whole-turn time limit; past it the turn is settled INCOMPLETE rather than hanging the presenter.
export const CHAT_TIMEOUT_MS = 45000
// Stored answers are capped to match the database CHECK constraint.
export const CHAT_ANSWER_MAX_CHARS = REPORT_LIMITS.chatAnswerChars
// Dedupe key on ai_jobs: only one streaming chat turn per session at a time.
export const CHAT_REPORT_DEDUPE_KEY = 'report-chat'
