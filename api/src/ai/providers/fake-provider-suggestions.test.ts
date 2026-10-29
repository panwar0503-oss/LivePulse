import { describe, expect, it } from 'vitest'
import { createFakeProvider } from './fake-provider.js'

const SUGGEST_SYSTEM = 'Write poll ideas. [task:suggest-polls]'
const passage = (index: number, text: string): string =>
  `<passage index="${index}" document="Notes.pdf" location="page 1">${text}</passage>`

type Poll = { question: string; options: string[]; passageIndex: number }

describe('offline poll ideas', () => {
  it('builds each poll from its passage, with no contact details in the options', async () => {
    const user = [
      passage(1, 'Contact me at someone@example.com. Ravi manages the site team and reports weekly.'),
      passage(2, 'The water line project finished in March. Call 7060530699 for details.'),
    ].join('\n')

    const reply = await createFakeProvider().complete({ system: SUGGEST_SYSTEM, user, maxOutputTokens: 800 })
    const { polls } = JSON.parse(reply.text) as { polls: Poll[] }

    expect(polls.map((poll) => poll.passageIndex)).toEqual([1, 2])
    expect(polls[0]?.question).toBe('Which topic does Notes.pdf cover most?')
    expect(polls[0]?.options[0]).toBe('Manages')
    expect(polls[1]?.options[0]).toBe('Water')
    const options = polls.flatMap((poll) => poll.options)
    expect(options.join(' ')).not.toMatch(/[\d@]/)
    expect(options.join(' ')).not.toMatch(/someone|example/)
    expect(options.every((option) => option.length <= 80)).toBe(true)
  })

  it('offers no poll when no passage has a usable sentence', async () => {
    const user = passage(1, 'Call 7060530699 or write to someone@example.com.')
    const reply = await createFakeProvider().complete({ system: SUGGEST_SYSTEM, user, maxOutputTokens: 800 })
    expect(JSON.parse(reply.text)).toEqual({ polls: [] })
  })
})
