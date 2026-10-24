import { randomInt } from 'node:crypto'
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@livepulse/shared'

/**
 * Builds a room code from ROOM_CODE_ALPHABET, which excludes the look-alikes 0, O, 1, I and L.
 * `random(max)` must return an integer in [0, max); injectable for tests.
 */
export function generateRoomCode(random: (max: number) => number = (max) => randomInt(max)): string {
  let code = ''
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[random(ROOM_CODE_ALPHABET.length)]
  }
  return code
}
