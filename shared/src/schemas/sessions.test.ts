import { describe, expect, it } from 'vitest'
import {
  createSessionBodySchema,
  createdSessionSchema,
  displayNameSchema,
  joinBodySchema,
  participantMeSchema,
  presenterAccessBodySchema,
  presenterKeySchema,
  presenterSessionSchema,
  presenterSessionStateSchema,
  roomCodeSchema,
  sessionDescriptionSchema,
  sessionTitleSchema,
} from './sessions.js'

describe('room code', () => {
  it('accepts a lowercase room code and returns it uppercased', () => {
    expect(roomCodeSchema.parse(' abc234 ')).toBe('ABC234')
  })

  it('rejects a room code with a look-alike character such as O or 0', () => {
    expect(roomCodeSchema.safeParse('ABCDE0').success).toBe(false)
    expect(roomCodeSchema.safeParse('ABCDEO').success).toBe(false)
  })

  it('rejects a room code that is too short or too long', () => {
    expect(roomCodeSchema.safeParse('ABC23').success).toBe(false)
    expect(roomCodeSchema.safeParse('ABC2345').success).toBe(false)
  })

  it('does not echo the submitted room code in its error message', () => {
    const result = roomCodeSchema.safeParse('zzzz!!')
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('Room code must be 6 letters or digits.')
    }
  })
})

describe('session title and description', () => {
  it('trims a title and rejects one longer than 80 characters', () => {
    expect(sessionTitleSchema.parse('  Town hall  ')).toBe('Town hall')
    expect(sessionTitleSchema.safeParse('a'.repeat(80)).success).toBe(true)
    expect(sessionTitleSchema.safeParse('a'.repeat(81)).success).toBe(false)
  })

  it('rejects a blank title', () => {
    expect(sessionTitleSchema.safeParse('   ').success).toBe(false)
  })

  it('rejects a title that contains a control character', () => {
    expect(sessionTitleSchema.safeParse('Bad\u0007title').success).toBe(false)
  })

  it('allows an empty description to be omitted', () => {
    expect(createSessionBodySchema.safeParse({ title: 'Town hall' }).success).toBe(true)
    expect(sessionDescriptionSchema.safeParse(undefined).success).toBe(true)
  })

  it('allows newlines in a description but rejects other control characters and over 500 characters', () => {
    expect(sessionDescriptionSchema.safeParse('Line one\nLine two\tend').success).toBe(true)
    expect(sessionDescriptionSchema.safeParse('bad\u0000text').success).toBe(false)
    expect(sessionDescriptionSchema.safeParse('a'.repeat(501)).success).toBe(false)
  })
})

describe('display name', () => {
  it('trims a display name and enforces 1 to 30 characters', () => {
    expect(displayNameSchema.parse('  Asha ')).toBe('Asha')
    expect(displayNameSchema.safeParse('').success).toBe(false)
    expect(displayNameSchema.safeParse('a'.repeat(30)).success).toBe(true)
    expect(displayNameSchema.safeParse('a'.repeat(31)).success).toBe(false)
  })

  it('rejects a display name that contains a control character', () => {
    expect(displayNameSchema.safeParse('As\nha').success).toBe(false)
  })

  it('requires a display name to join', () => {
    expect(joinBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('presenter key', () => {
  const validKey = 'A1b2C3d4E5f6G7h8I9j0_-'

  it('accepts a base64url presenter key', () => {
    expect(presenterAccessBodySchema.safeParse({ presenterKey: validKey }).success).toBe(true)
  })

  it('rejects a presenter key shorter than 20 characters', () => {
    expect(presenterKeySchema.safeParse('short').success).toBe(false)
  })

  it('rejects a presenter key longer than 100 characters or with other characters', () => {
    expect(presenterKeySchema.safeParse('a'.repeat(101)).success).toBe(false)
    expect(presenterKeySchema.safeParse(`${validKey}+/=`).success).toBe(false)
  })
})

describe('session responses', () => {
  const id = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b'

  it('accepts a created session with a join link', () => {
    const result = createdSessionSchema.safeParse({
      sessionId: id,
      roomCode: 'ABC234',
      joinUrl: 'http://localhost:3000/join/ABC234',
      presenterKey: 'A1b2C3d4E5f6G7h8I9j0',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a presenter session with a negative participant count', () => {
    const result = presenterSessionSchema.safeParse({
      id,
      title: 'Town hall',
      description: null,
      roomCode: 'ABC234',
      joinUrl: 'http://localhost:3000/join/ABC234',
      status: 'ACTIVE',
      endedAt: null,
      participantCount: -1,
    })
    expect(result.success).toBe(false)
  })

  it('rejects a participant view of a session with an unknown status', () => {
    const result = participantMeSchema.safeParse({
      participant: { displayName: 'Asha' },
      session: { title: 'Town hall', status: 'PAUSED', roomCode: 'ABC234' },
    })
    expect(result.success).toBe(false)
  })
})

describe('presenter session state', () => {
  const state = {
    id: '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b',
    title: 'Town hall',
    roomCode: 'ABC234',
    status: 'ACTIVE',
    endedAt: null,
    joinedCount: 12,
    connectedCount: 4,
  }

  it('accepts a live session state with a connected count', () => {
    expect(presenterSessionStateSchema.safeParse(state).success).toBe(true)
  })

  it('accepts a null connected count when the live count could not be taken', () => {
    expect(presenterSessionStateSchema.safeParse({ ...state, connectedCount: null }).success).toBe(true)
  })

  it('accepts an ended session with an endedAt timestamp', () => {
    const result = presenterSessionStateSchema.safeParse({
      ...state,
      status: 'ENDED',
      endedAt: '2026-10-24T10:00:00.000Z',
    })
    expect(result.success).toBe(true)
  })

  it('rejects a negative joined count', () => {
    expect(presenterSessionStateSchema.safeParse({ ...state, joinedCount: -1 }).success).toBe(false)
  })

  it('rejects a state with an unknown status', () => {
    expect(presenterSessionStateSchema.safeParse({ ...state, status: 'PAUSED' }).success).toBe(false)
  })
})
