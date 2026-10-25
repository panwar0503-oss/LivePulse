import { AiProviderError } from './llm-provider.js'

function readField(err: unknown, field: 'status' | 'name'): unknown {
  return typeof err === 'object' && err !== null && field in err
    ? (err as Record<string, unknown>)[field]
    : undefined
}

// Reads only the HTTP status and error name, never the provider's message.
export function mapProviderError(err: unknown): AiProviderError {
  if (err instanceof AiProviderError) return err
  const opts = { cause: err }
  const name = readField(err, 'name')
  if (name === 'AbortError' || name === 'TimeoutError') {
    return new AiProviderError('PROVIDER_TIMEOUT', true, opts)
  }
  const status = readField(err, 'status')
  if (typeof status !== 'number') {
    // An Error without an HTTP status is a network failure.
    return err instanceof Error
      ? new AiProviderError('PROVIDER_UNAVAILABLE', true, opts)
      : new AiProviderError('INTERNAL', false, opts)
  }
  if (status === 429) return new AiProviderError('PROVIDER_RATE_LIMITED', true, opts)
  if (status === 529 || (status >= 500 && status <= 599)) {
    return new AiProviderError('PROVIDER_UNAVAILABLE', true, opts)
  }
  if (status === 401 || status === 403) return new AiProviderError('PROVIDER_AUTH', false, opts)
  if (status === 400) return new AiProviderError('PROVIDER_REJECTED', false, opts)
  return new AiProviderError('INTERNAL', false, opts)
}
