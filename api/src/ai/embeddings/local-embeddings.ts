import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EmbeddingsError, type EmbeddingsProvider } from './embeddings-provider.js'

// api/src/ai/embeddings -> api/.cache/models, independent of the process cwd.
export const defaultCacheDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../.cache/models',
)

type Extractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: boolean },
) => Promise<{ tolist(): number[][] }>

export interface LocalEmbeddingsOptions {
  model: string
  dimension: number
  cacheDir?: string
}

export const createLocalEmbeddings = ({
  model,
  dimension,
  cacheDir = defaultCacheDir,
}: LocalEmbeddingsOptions): EmbeddingsProvider => {
  let extractor: Promise<Extractor> | undefined

  // Loaded lazily so importing this module never pulls in the library or downloads a model.
  const load = (): Promise<Extractor> => {
    if (!extractor) {
      const loading = import('@huggingface/transformers').then(async ({ pipeline }) => {
        const created: unknown = await pipeline('feature-extraction', model, { cache_dir: cacheDir })
        // The library's pipeline union is too large to type-check; the call shape is fixed by Extractor.
        return created as Extractor
      })
      extractor = loading
      // Allow a retry after a failed load instead of caching the rejection.
      loading.catch(() => {
        extractor = undefined
      })
    }
    return extractor
  }

  return {
    name: 'local',
    model,
    dimension,
    embed: async (texts) => {
      try {
        const run = await load()
        const vectors = (await run(texts, { pooling: 'mean', normalize: true })).tolist()
        if (vectors.length !== texts.length || vectors.some((v) => v.length !== dimension)) {
          throw new EmbeddingsError()
        }
        return vectors
      } catch (error) {
        throw error instanceof EmbeddingsError ? error : new EmbeddingsError({ cause: error })
      }
    },
  }
}
