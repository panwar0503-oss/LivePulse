import { describe, expect, it } from 'vitest'
import {
  createWordPromptBodySchema,
  normaliseWord,
  submitWordBodySchema,
  updateWordPromptBodySchema,
  wordCloudSchema,
} from './word-cloud.js'

const submit = (text: string) => submitWordBodySchema.safeParse({ text })

describe('word normalisation', () => {
  it('keeps accents and only lowercases for the key', () => {
    expect(normaliseWord('Café')).toEqual({ display: 'Café', key: 'café' })
  })

  it('treats a word written with a combining accent the same as the precomposed one', () => {
    const a = normaliseWord('Café')
    const b = normaliseWord('Café')
    expect(a).toEqual(b)
    expect(a.display).toBe('Café')
  })

  it('treats tabs, newlines and non-breaking spaces as one space', () => {
    expect(normaliseWord('  big\t\n  idea ').display).toBe('big idea')
  })

  it('counts case-only differences as the same key', () => {
    expect(normaliseWord('HELLO').key).toBe(normaliseWord('hello').key)
  })

  it('treats a zero-width-only answer as empty', () => {
    const result = submit('​‍﻿')
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Type a word or short phrase.')
  })

  it('removes a zero-width space inside a word', () => {
    expect(normaliseWord('he​llo').display).toBe('hello')
  })

  it('keeps typed markup such as <b> as plain text', () => {
    const parsed = submitWordBodySchema.parse({ text: '<b>' })
    expect(parsed.text.display).toBe('<b>')
  })

  it('accepts exactly 30 characters', () => {
    expect(submit('a'.repeat(30)).success).toBe(true)
  })

  it('refuses 31 characters with the 30 limit message', () => {
    const result = submit('a'.repeat(31))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Use 30 characters or fewer.')
  })

  it('refuses an empty or whitespace-only answer with the type-a-word message', () => {
    for (const text of ['', '   \t\n']) {
      const result = submit(text)
      expect(result.success).toBe(false)
      expect(result.error?.issues[0]?.message).toBe('Type a word or short phrase.')
    }
  })

  it('refuses a raw answer over 200 characters before normalising', () => {
    // Would normalise to 1 character, but the raw text is too long.
    const result = submit('a' + ' '.repeat(200))
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toBe('Use 200 characters or fewer.')
  })

  it('lowercases the Turkish capital dotted I consistently for the key', () => {
    const first = normaliseWord('İstanbul')
    const second = normaliseWord('İstanbul')
    expect(first.display).toBe('İstanbul')
    expect(first.key).toBe(second.key)
  })
})

describe('word prompt bodies', () => {
  it('defaults showCloud to true', () => {
    expect(createWordPromptBodySchema.parse({ question: 'One word?' }).showCloud).toBe(true)
  })

  it('requires showCloud in the update body', () => {
    expect(updateWordPromptBodySchema.safeParse({}).success).toBe(false)
    expect(updateWordPromptBodySchema.safeParse({ showCloud: false }).success).toBe(true)
  })

  it('rejects a question longer than 200 characters', () => {
    expect(createWordPromptBodySchema.safeParse({ question: 'q'.repeat(201) }).success).toBe(false)
  })

  it('rejects a question with control characters', () => {
    expect(createWordPromptBodySchema.safeParse({ question: 'a\u0007b' }).success).toBe(false)
  })
})

describe('word cloud', () => {
  it('accepts an empty cloud', () => {
    expect(wordCloudSchema.safeParse({ total: 0, version: 0, entries: [] }).success).toBe(true)
  })

  it('rejects a cloud with more than 30 entries', () => {
    const entries = Array.from({ length: 31 }, (_, i) => ({ key: `w${i}`, word: `w${i}`, count: 1 }))
    expect(wordCloudSchema.safeParse({ total: 31, version: 1, entries }).success).toBe(false)
  })
})
