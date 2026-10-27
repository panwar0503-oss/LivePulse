import { KNOWLEDGE_LIMITS } from '@livepulse/shared'
import { describe, expect, it } from 'vitest'
import { chunkPages, type Passage } from './chunker.js'

const sentence = (n: number): string => `Sentence number ${n} talks about the quarterly roadmap in detail.`
const paragraph = (from: number, count: number): string =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(' ')

const passagesOf = (result: ReturnType<typeof chunkPages>): Passage[] => {
  if (!('passages' in result)) throw new Error('expected passages')
  return result.passages
}

describe('chunker', () => {
  it('a text file is split into numbered sections with overlap', () => {
    const text = [paragraph(1, 8), paragraph(9, 8), paragraph(17, 8), paragraph(25, 8)].join('\n\n')
    const passages = passagesOf(chunkPages(text))

    expect(passages.length).toBeGreaterThan(1)
    passages.forEach((passage, index) => {
      expect(passage.ordinal).toBe(index + 1)
      expect(passage.sectionNumber).toBe(index + 1)
      expect(passage.pageNumber).toBeNull()
      expect(passage.content.length).toBeLessThanOrEqual(
        KNOWLEDGE_LIMITS.passageChars + KNOWLEDGE_LIMITS.passageOverlap + 1,
      )
    })
    // Each section starts with the end of the previous one.
    for (let i = 1; i < passages.length; i += 1) {
      const start = passages[i]?.content.slice(0, 40) ?? ''
      expect(start.length).toBeGreaterThan(0)
      expect(passages[i - 1]?.content).toContain(start)
    }
    // No text is lost.
    for (let n = 1; n <= 32; n += 1) {
      expect(passages.some((p) => p.content.includes(sentence(n)))).toBe(true)
    }
  })

  it('a PDF page never spans two pages', () => {
    const passages = passagesOf(chunkPages(['Page one is short.', paragraph(1, 30), 'Page three.']))

    expect(passages[0]).toEqual({
      ordinal: 1,
      content: 'Page one is short.',
      pageNumber: 1,
      sectionNumber: null,
    })
    expect(passages.at(-1)).toMatchObject({ content: 'Page three.', pageNumber: 3, sectionNumber: null })
    const middle = passages.filter((p) => p.pageNumber === 2)
    expect(middle.length).toBeGreaterThan(1)
    expect(middle.every((p) => !p.content.includes('Page one') && !p.content.includes('Page three'))).toBe(
      true,
    )
    expect(passages.map((p) => p.ordinal)).toEqual(passages.map((_, i) => i + 1))
  })

  it('a page with only whitespace produces no passage', () => {
    const passages = passagesOf(chunkPages(['  \n\t  ', '', 'Real text on page three.']))
    expect(passages).toEqual([
      { ordinal: 1, content: 'Real text on page three.', pageNumber: 3, sectionNumber: null },
    ])
    expect(passagesOf(chunkPages('   \n\n  '))).toEqual([])
  })

  it('a very long sentence without boundaries is cut to the passage size', () => {
    const passages = passagesOf(chunkPages('x'.repeat(2000)))
    expect(passages.every((p) => p.content.length <= KNOWLEDGE_LIMITS.maxPassageChars)).toBe(true)
    expect(passages.length).toBeGreaterThan(2)
  })

  it('a document longer than the passage limit is refused as too large', () => {
    const pages = Array.from({ length: KNOWLEDGE_LIMITS.maxPassagesPerDocument + 1 }, (_, i) => `Page ${i}.`)
    expect(chunkPages(pages)).toEqual({ refusal: 'TOO_LARGE_TEXT' })
    expect(passagesOf(chunkPages(pages.slice(1)))).toHaveLength(KNOWLEDGE_LIMITS.maxPassagesPerDocument)
  })
})
