import type { Reranker } from './reranker.js'

const tokens = (text: string): Set<string> => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])

// Share of the query's distinct words found in the passage: deterministic and offline.
export const createFakeReranker = (): Reranker => ({
  name: 'fake',
  rerank: ({ query, passages }) => {
    const queryTokens = tokens(query)
    const scores: Record<string, number> = {}
    for (const { id, text } of passages) {
      const passageTokens = tokens(text)
      const shared = [...queryTokens].filter((token) => passageTokens.has(token)).length
      scores[id] = queryTokens.size === 0 ? 0 : shared / queryTokens.size
    }
    return Promise.resolve({ scores, reranked: true })
  },
})
