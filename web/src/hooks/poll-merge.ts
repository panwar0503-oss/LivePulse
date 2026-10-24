import type { PollResults } from '@livepulse/shared'

// Votes are final, so the version (total votes) only grows: the higher version is the fresher one.
export const mergePollResults = (
  snapshot: PollResults | null,
  live: PollResults | undefined,
): PollResults | null => {
  if (!live) return snapshot
  if (!snapshot) return live
  return live.version > snapshot.version ? live : snapshot
}

// Live results belong to the poll that is on screen; results for any other poll are ignored.
export const liveResultsFor = (
  shownPollId: string | null,
  live: Record<string, PollResults>,
): PollResults | undefined => (shownPollId === null ? undefined : live[shownPollId])
