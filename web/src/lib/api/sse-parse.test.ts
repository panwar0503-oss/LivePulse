import { describe, expect, it } from 'vitest'
import { createSseParser, STREAM_ERROR_MESSAGE } from './sse-parse'

const TURN = '11111111-1111-4111-8111-111111111111'

describe('answer stream parser', () => {
  it('a frame split across two chunks is read whole', () => {
    const parser = createSseParser()
    expect(parser.push('event: delta\ndata: {"type":"del')).toEqual([])
    expect(parser.push('ta","text":"Hello"}\n\n')).toEqual([{ type: 'delta', text: 'Hello' }])
  })

  it('a malformed frame becomes an error event', () => {
    const events = createSseParser().push('event: delta\ndata: {not json\n\n')
    expect(events).toEqual([{ type: 'error', code: 'INVALID_OUTPUT', message: STREAM_ERROR_MESSAGE }])
  })

  it('an event with an unknown kind is refused', () => {
    const events = createSseParser().push('data: {"type":"script","text":"x"}\n\n')
    expect(events).toEqual([{ type: 'error', code: 'INVALID_OUTPUT', message: STREAM_ERROR_MESSAGE }])
  })

  it('comment lines are ignored', () => {
    const events = createSseParser().push(
      ': keep-alive\n\n: ping\ndata: {"type":"tool","name":"get_polls"}\n\n',
    )
    expect(events).toEqual([{ type: 'tool', name: 'get_polls' }])
  })

  it('a done event carries its sources', () => {
    const sources = [{ kind: 'poll', ref: 'poll:1', label: 'Lunch poll' }]
    const frame = `event: done\ndata: ${JSON.stringify({ type: 'done', turnId: TURN, sources })}\n\n`
    expect(createSseParser().push(frame)).toEqual([{ type: 'done', turnId: TURN, sources }])
  })
})
