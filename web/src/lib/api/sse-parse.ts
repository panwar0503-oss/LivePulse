import { chatStreamEventSchema, type ChatSource } from '@livepulse/shared'

export const STREAM_ERROR_MESSAGE = 'The answer could not be completed. Please try again.'

// What the UI receives: only fields the page needs, with a fixed error text instead of server wording.
export type StreamEvent =
  | { type: 'start'; turnId: string }
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'done'; turnId: string; sources: ChatSource[] }
  | { type: 'error'; code: string; message: string }

const invalid: StreamEvent = { type: 'error', code: 'INVALID_OUTPUT', message: STREAM_ERROR_MESSAGE }

const toEvent = (data: string): StreamEvent => {
  let json: unknown
  try {
    json = JSON.parse(data)
  } catch {
    return invalid
  }
  const parsed = chatStreamEventSchema.safeParse(json)
  if (!parsed.success) return invalid
  const event = parsed.data
  switch (event.type) {
    case 'start':
      return { type: 'start', turnId: event.turnId }
    case 'delta':
      return { type: 'delta', text: event.text }
    case 'tool':
      return { type: 'tool', name: event.name }
    case 'done':
      return { type: 'done', turnId: event.turnId, sources: event.sources }
    case 'error':
      return { type: 'error', code: event.code, message: STREAM_ERROR_MESSAGE }
  }
}

// Frames are separated by a blank line. `data:` lines join with a newline; `:` lines are comments.
// A frame with no data lines (comment only) yields nothing. The `event:` name is not trusted:
// the kind comes from the validated data object.
const frameData = (frame: string): string | null => {
  const data: string[] = []
  for (const line of frame.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  return data.length > 0 ? data.join('\n') : null
}

export const createSseParser = (): { push: (chunk: string) => StreamEvent[] } => {
  let buffer = ''
  return {
    push(chunk) {
      buffer = (buffer + chunk).replace(/\r\n?/g, '\n')
      const events: StreamEvent[] = []
      let end = buffer.indexOf('\n\n')
      while (end !== -1) {
        const data = frameData(buffer.slice(0, end))
        buffer = buffer.slice(end + 2)
        if (data !== null) events.push(toEvent(data))
        end = buffer.indexOf('\n\n')
      }
      return events
    },
  }
}
