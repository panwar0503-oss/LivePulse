import { KNOWLEDGE_LIMITS } from '@livepulse/shared'

export type Passage =
  | { ordinal: number; content: string; pageNumber: number; sectionNumber: null }
  | { ordinal: number; content: string; pageNumber: null; sectionNumber: number }

export type ChunkResult = { passages: Passage[] } | { refusal: 'TOO_LARGE_TEXT' }

export interface ChunkOptions {
  passageChars: number
  passageOverlap: number
  maxPassages: number
  maxPassageChars: number
}

const defaultOptions: ChunkOptions = {
  passageChars: KNOWLEDGE_LIMITS.passageChars,
  passageOverlap: KNOWLEDGE_LIMITS.passageOverlap,
  maxPassages: KNOWLEDGE_LIMITS.maxPassagesPerDocument,
  maxPassageChars: KNOWLEDGE_LIMITS.maxPassageChars,
}

interface Unit {
  text: string
  // Units from the same paragraph are joined with a space, new paragraphs with a blank line.
  startsParagraph: boolean
}

const hardSplit = (text: string, size: number): string[] => {
  const parts: string[] = []
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size))
  return parts
}

// Paragraphs first; a paragraph that is too long is split into sentences, and a sentence that is
// still too long is cut at the size limit.
const toUnits = (text: string, size: number): Unit[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter((paragraph) => paragraph.length > 0)
    .flatMap((paragraph) => {
      const pieces =
        paragraph.length <= size
          ? [paragraph]
          : paragraph.split(/(?<=[.!?])\s+/).flatMap((sentence) => hardSplit(sentence, size))
      return pieces.map((piece, index) => ({ text: piece, startsParagraph: index === 0 }))
    })

// The end of the previous passage, starting at a word boundary when one exists.
const overlapTail = (previous: string, overlap: number): string => {
  if (overlap <= 0) return ''
  const tail = previous.slice(-overlap)
  const space = tail.search(/\s/)
  return (space > 0 && tail.length === overlap ? tail.slice(space) : tail).trim()
}

const chunkText = (text: string, options: ChunkOptions): string[] => {
  const chunks: string[] = []
  let current = ''
  for (const unit of toUnits(text, options.passageChars)) {
    const separator = unit.startsParagraph ? '\n\n' : ' '
    if (current.length > 0 && current.length + separator.length + unit.text.length > options.passageChars) {
      chunks.push(current)
      const tail = overlapTail(current, options.passageOverlap)
      current = tail.length > 0 ? `${tail} ${unit.text}` : unit.text
    } else {
      current = current.length > 0 ? `${current}${separator}${unit.text}` : unit.text
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

// PDF input is one text per page (location = page number); text input is one string
// (location = section number, counting passages). A passage never spans two pages.
export const chunkPages = (input: string[] | string, overrides: Partial<ChunkOptions> = {}): ChunkResult => {
  const options = { ...defaultOptions, ...overrides }
  if (options.passageChars + options.passageOverlap + 1 > options.maxPassageChars) {
    throw new RangeError('passageChars plus passageOverlap must fit within maxPassageChars')
  }

  const pages = typeof input === 'string' ? [input] : input
  const passages: Passage[] = []
  for (const [pageIndex, page] of pages.entries()) {
    for (const chunk of chunkText(page, options)) {
      const content = chunk.trim()
      if (content.length === 0) continue
      if (passages.length >= options.maxPassages) return { refusal: 'TOO_LARGE_TEXT' }
      const ordinal = passages.length + 1
      passages.push(
        typeof input === 'string'
          ? { ordinal, content, pageNumber: null, sectionNumber: ordinal }
          : { ordinal, content, pageNumber: pageIndex + 1, sectionNumber: null },
      )
    }
  }
  return { passages }
}
