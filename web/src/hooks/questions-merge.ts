import type { QuestionUpvotes } from '@livepulse/shared'

export type UpvoteSnapshot<T extends { id: string; upvotes: number }> = {
  // Version of the live list already reflected in the questions (0 when none was seen yet).
  version: number
  questions: T[]
}

// Live counts win only when newer; their server order fills the slots of the questions they cover.
export const mergeUpvotes = <T extends { id: string; upvotes: number }>(
  snapshot: UpvoteSnapshot<T>,
  live: QuestionUpvotes | null | undefined,
): UpvoteSnapshot<T> => {
  if (!live || live.version <= snapshot.version) return snapshot
  const byId = new Map(snapshot.questions.map((q) => [q.id, q]))
  const ordered: T[] = []
  for (const entry of live.questions) {
    const question = byId.get(entry.id)
    if (question) ordered.push({ ...question, upvotes: entry.upvotes })
  }
  const covered = new Set(ordered.map((q) => q.id))
  let next = 0
  const questions = snapshot.questions.map((q) => {
    if (!covered.has(q.id)) return q
    const replacement = ordered[next]
    next += 1
    return replacement ?? q
  })
  return { version: live.version, questions }
}

// Counts for questions that are not on screen are ignored.
export const liveUpvotesFor = (
  shownIds: readonly string[],
  live: QuestionUpvotes | null,
): QuestionUpvotes | null => {
  if (!live) return null
  const shown = new Set(shownIds)
  return { version: live.version, questions: live.questions.filter((q) => shown.has(q.id)) }
}
