export interface EmbeddingsProvider {
  readonly name: 'fake' | 'local'
  readonly model: string
  readonly dimension: number
  embed(texts: string[]): Promise<number[][]>
}

// The message is fixed on purpose: model internals and file paths must not leak to callers or logs.
export class EmbeddingsError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('Embeddings are unavailable', options)
    this.name = 'EmbeddingsError'
  }
}
