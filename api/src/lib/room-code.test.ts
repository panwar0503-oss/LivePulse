import { ROOM_CODE_ALPHABET, roomCodeSchema } from '@livepulse/shared'
import { describe, expect, it } from 'vitest'
import { generateRoomCode } from './room-code.js'

describe('generateRoomCode', () => {
  it('never generates a code with a look-alike character', () => {
    for (let i = 0; i < 1000; i++) {
      expect(generateRoomCode()).not.toMatch(/[O01IL]/)
    }
  })

  it('generates codes that the shared room code schema accepts', () => {
    for (let i = 0; i < 100; i++) {
      expect(roomCodeSchema.safeParse(generateRoomCode()).success).toBe(true)
    }
  })

  it('builds a six-character code from the injected random source', () => {
    const picks = [0, 1, 2, 29, 30, 8]
    let call = 0
    const code = generateRoomCode(() => picks[call++] ?? 0)
    expect(code).toBe('ABC89J')
    expect(code).toHaveLength(6)
  })

  it('asks the random source for an index within the alphabet', () => {
    const maxes: number[] = []
    generateRoomCode((max) => {
      maxes.push(max)
      return 0
    })
    expect(maxes).toEqual(Array(6).fill(ROOM_CODE_ALPHABET.length))
  })
})
