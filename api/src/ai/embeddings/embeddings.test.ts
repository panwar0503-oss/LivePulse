import { EMBEDDING_DIM } from '@livepulse/shared'
import { describe, expect, it } from 'vitest'
import { toPgVector } from '../vector.js'
import { createFakeEmbeddings } from './fake-embeddings.js'

describe('fake embeddings', () => {
  const fake = createFakeEmbeddings()

  it('the fake embeddings have the configured length', async () => {
    const [vector] = await fake.embed(['hello'])
    expect(vector).toHaveLength(EMBEDDING_DIM)
    expect(vector?.every(Number.isFinite)).toBe(true)
    const [short] = await createFakeEmbeddings(5).embed(['hello'])
    expect(short).toHaveLength(5)
  })

  it('the same text always gives the same vector', async () => {
    const [a] = await fake.embed(['What is next?'])
    const [b] = await createFakeEmbeddings().embed(['What is next?'])
    expect(a).toEqual(b)
  })

  it('vectors are unit length', async () => {
    const vectors = await fake.embed(['one', 'two', ''])
    for (const v of vectors) {
      expect(Math.sqrt(v.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6)
    }
  })

  it('the fake embeddings never change with a different text order (per text)', async () => {
    const forward = await fake.embed(['alpha', 'beta'])
    const reversed = await fake.embed(['beta', 'alpha'])
    expect(forward[0]).toEqual(reversed[1])
    expect(forward[1]).toEqual(reversed[0])
    expect(forward[0]).not.toEqual(forward[1])
  })
})

describe('toPgVector', () => {
  it('toPgVector refuses a wrong length', () => {
    expect(() => toPgVector([1, 2], 3)).toThrow()
  })

  it('toPgVector refuses a non-finite value', () => {
    expect(() => toPgVector([1, Number.NaN, 3], 3)).toThrow()
    expect(() => toPgVector([1, Infinity, 3], 3)).toThrow()
  })

  it('toPgVector writes a bracketed list', () => {
    expect(toPgVector([1, 0.5, -2], 3)).toBe('[1,0.5,-2]')
  })
})
