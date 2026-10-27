import { describe, expect, it } from 'vitest'
import { createLocalReranker } from '../../src/knowledge/reranker/local-reranker.js'

// Opt-in: the first run downloads the cross-encoder model into the local cache. Runs only with AI_LIVE_TEST=1.
const model = process.env.RERANKER_MODEL ?? 'Xenova/ms-marco-MiniLM-L-6-v2'

describe.runIf(process.env.AI_LIVE_TEST === '1')('local reranker live', () => {
  it('scores a passage about the query topic above an unrelated one', async () => {
    const reranker = createLocalReranker({ model })
    const query = 'How do I look after my cat?'
    const passages = [
      {
        id: 'cats',
        text: 'Cats are small domesticated animals that need regular feeding, grooming and vet checkups.',
      },
      {
        id: 'tax',
        text: 'Tax law sets out how income, capital gains and corporate profits are assessed and paid.',
      },
    ]

    const result = await reranker.rerank({ query, passages })

    expect(result.reranked).toBe(true)
    if (!result.reranked) return
    // Scores are printed (never the passage text) so the developer can compare them with RERANK_MIN_SCORE.
    process.stdout.write(
      `[reranker-live] model=${model} cats=${result.scores.cats} tax=${result.scores.tax}\n`,
    )
    const catScore = result.scores.cats ?? Number.NaN
    const taxScore = result.scores.tax ?? Number.NaN
    expect(catScore).toBeGreaterThan(taxScore)
  }, 300_000)
})
