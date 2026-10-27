import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_LIMITS,
  knowledgeFileNameSchema,
  knowledgeResultSchema,
  knowledgeSearchBodySchema,
} from './knowledge.js'

describe('knowledge schemas', () => {
  it('accepts a PDF name', () => {
    expect(knowledgeFileNameSchema.safeParse('Quarterly slides.pdf').success).toBe(true)
    expect(knowledgeFileNameSchema.safeParse('notes.txt').success).toBe(true)
  })

  it('refuses a .md name', () => {
    expect(knowledgeFileNameSchema.safeParse('notes.md').success).toBe(false)
  })

  it('refuses a path separator', () => {
    expect(knowledgeFileNameSchema.safeParse('../secret.pdf').success).toBe(false)
    expect(knowledgeFileNameSchema.safeParse('dir\\file.txt').success).toBe(false)
    expect(knowledgeFileNameSchema.safeParse('bad\nname.pdf').success).toBe(false)
  })

  it('refuses a query over 500 characters', () => {
    const max = KNOWLEDGE_LIMITS.searchQueryMaxChars
    expect(knowledgeSearchBodySchema.safeParse({ query: 'a'.repeat(max) }).success).toBe(true)
    expect(knowledgeSearchBodySchema.safeParse({ query: 'a'.repeat(max + 1) }).success).toBe(false)
    expect(knowledgeSearchBodySchema.safeParse({ query: '   ' }).success).toBe(false)
  })

  it('refuses an unknown key in the search body', () => {
    expect(knowledgeSearchBodySchema.safeParse({ query: 'pricing', sessionId: 'x' }).success).toBe(false)
  })

  it('a location must be page or section', () => {
    const result = (location: unknown) =>
      knowledgeResultSchema.safeParse({ documentName: 'a.pdf', location, text: 't', score: 0.5 }).success
    expect(result({ kind: 'page', number: 3 })).toBe(true)
    expect(result({ kind: 'section', number: 1 })).toBe(true)
    expect(result({ kind: 'slide', number: 1 })).toBe(false)
    expect(result({ kind: 'page', number: 0 })).toBe(false)
  })
})
