// Dismissed suggestion indexes belong to one job; a newer job starts with none. Kept in memory only.
export type DismissedState = { jobId: string | null; indexes: number[] }

export const noneDismissed: DismissedState = { jobId: null, indexes: [] }

export const dismissIndex = (prev: DismissedState, jobId: string, index: number): DismissedState => {
  const indexes = prev.jobId === jobId ? prev.indexes : []
  return indexes.includes(index) ? { jobId, indexes } : { jobId, indexes: [...indexes, index] }
}

export const dismissedFor = (state: DismissedState, jobId: string | null): ReadonlySet<number> =>
  new Set(state.jobId !== null && state.jobId === jobId ? state.indexes : [])
