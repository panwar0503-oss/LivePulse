import type { Env } from '../../config/env.js'
import type { EmbeddingsProvider } from './embeddings-provider.js'
import { createFakeEmbeddings } from './fake-embeddings.js'
import { createLocalEmbeddings } from './local-embeddings.js'

export const createEmbeddingsProvider = (
  env: Pick<Env, 'EMBEDDINGS_PROVIDER' | 'EMBEDDINGS_MODEL' | 'EMBEDDINGS_DIM'>,
): EmbeddingsProvider =>
  env.EMBEDDINGS_PROVIDER === 'fake'
    ? createFakeEmbeddings(env.EMBEDDINGS_DIM)
    : createLocalEmbeddings({ model: env.EMBEDDINGS_MODEL, dimension: env.EMBEDDINGS_DIM })

export { EmbeddingsError, type EmbeddingsProvider } from './embeddings-provider.js'
