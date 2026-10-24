import type { WordCloud } from '@livepulse/shared'

// Submissions only add, so the higher version is the fresher cloud.
export const mergeWordCloud = (snapshot: WordCloud | null, live: WordCloud | undefined): WordCloud | null => {
  if (!live) return snapshot
  if (!snapshot) return live
  return live.version > snapshot.version ? live : snapshot
}

// A live cloud belongs to the prompt on screen; clouds for any other prompt are ignored.
export const liveCloudFor = (
  shownPromptId: string | null,
  live: Record<string, WordCloud>,
): WordCloud | undefined => (shownPromptId === null ? undefined : live[shownPromptId])
