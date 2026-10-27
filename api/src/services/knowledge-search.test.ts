import type { Sequelize } from 'sequelize'
import { describe, expect, it } from 'vitest'
import { createFakeEmbeddings } from '../ai/embeddings/fake-embeddings.js'
import type { Reranker } from '../knowledge/reranker/index.js'
import { applyThreshold, fuseRankings, searchKnowledge } from './knowledge-search.service.js'

describe('knowledge search ranking', () => {
  it('passages found by both meaning and keyword rank above passages found by one', () => {
    expect(fuseRankings(['a', 'b', 'c'], ['d', 'c', 'e'], 60)[0]).toBe('c')
    expect(fuseRankings(['a', 'b'], ['b', 'c'], 60)).toEqual(['b', 'a', 'c'])
  })

  it('ties are ordered deterministically', () => {
    expect(fuseRankings(['b'], ['a'], 60)).toEqual(['a', 'b'])
    expect(fuseRankings(['a'], ['b'], 60)).toEqual(['a', 'b'])
  })

  it('a passage below the score threshold is dropped', () => {
    const kept = applyThreshold(
      [
        { id: 'x', score: 0.9 },
        { id: 'y', score: 0.1 },
      ],
      0.5,
    )
    expect(kept).toEqual([{ id: 'x', score: 0.9 }])
  })

  it('when the reranker is unavailable the fused order is kept and reranked is false', async () => {
    const row = (id: string) => ({
      id,
      content: `text ${id}`,
      page_number: 2,
      section_number: null,
      file_name: 'a.pdf',
    })
    const sequelize = { query: () => Promise.resolve([row('p2'), row('p1')]) } as unknown as Sequelize
    const reranker: Reranker = { name: 'local', rerank: () => Promise.reject(new Error('model missing')) }
    const result = await searchKnowledge(
      {
        sequelize,
        // The ranking path never touches the models; only the SQL queries are stubbed above.
        models: {} as never,
        embeddings: createFakeEmbeddings(),
        reranker,
        limits: { searchResults: 8 },
      },
      { sessionId: '00000000-0000-4000-8000-000000000000', query: 'text' },
    )
    expect(result.reranked).toBe(false)
    expect(result.results.map((r) => r.text)).toEqual(['text p2', 'text p1'])
    expect(result.results[0]?.location).toEqual({ kind: 'page', number: 2 })
  })
})
