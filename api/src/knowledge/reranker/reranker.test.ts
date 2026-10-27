import { describe, expect, it } from 'vitest'
import { createFakeReranker, createReranker } from './index.js'

describe('fake reranker', () => {
  it('scores the passage sharing the most query words highest, the same way every time', async () => {
    const reranker = createFakeReranker()
    const input = {
      query: 'Hiring plan for Q3',
      passages: [
        { id: 'a', text: 'The office move is planned for spring.' },
        { id: 'b', text: 'Our hiring plan for Q3 adds two engineers.' },
        { id: 'c', text: 'Hiring is paused.' },
      ],
    }
    const first = await reranker.rerank(input)
    expect(first).toEqual({ reranked: true, scores: { a: 0.25, b: 1, c: 0.25 } })
    expect(await reranker.rerank(input)).toEqual(first)
  })

  it('a query with no words scores every passage zero', async () => {
    const result = await createFakeReranker().rerank({ query: '?!', passages: [{ id: 'a', text: 'Hello' }] })
    expect(result).toEqual({ reranked: true, scores: { a: 0 } })
  })

  it('the default configuration uses the fake reranker and never loads a model', () => {
    expect(createReranker({ RERANKER_PROVIDER: 'fake', RERANKER_MODEL: 'unused' }).name).toBe('fake')
  })
})
