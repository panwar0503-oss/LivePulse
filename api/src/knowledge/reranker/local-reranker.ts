import { defaultCacheDir } from '../../ai/embeddings/local-embeddings.js'
import type { Reranker } from './reranker.js'

// Cross-encoder usage: tokenize (query, passage) pairs and score them with a sequence
// classification model; ms-marco models return one relevance logit per pair.
type Tokenizer = (
  texts: string[],
  options: { text_pair: string[]; padding: true; truncation: true },
) => Record<string, unknown>
type Scorer = (
  inputs: Record<string, unknown>,
) => Promise<{ logits: { sigmoid(): { tolist(): number[][] } } }>

interface CrossEncoder {
  tokenizer: Tokenizer
  model: Scorer
}

export interface LocalRerankerOptions {
  model: string
  cacheDir?: string
}

export const createLocalReranker = ({
  model,
  cacheDir = defaultCacheDir,
}: LocalRerankerOptions): Reranker => {
  let encoder: Promise<CrossEncoder> | undefined

  // Loaded lazily so importing this module never pulls in the library or downloads a model.
  const load = (): Promise<CrossEncoder> => {
    if (!encoder) {
      const loading = import('@huggingface/transformers').then(
        async ({ AutoTokenizer, AutoModelForSequenceClassification }) => {
          const [tokenizer, scorer] = await Promise.all([
            AutoTokenizer.from_pretrained(model, { cache_dir: cacheDir }),
            AutoModelForSequenceClassification.from_pretrained(model, { cache_dir: cacheDir }),
          ])
          // Both are callable objects whose library types are too broad; the call shapes are fixed above.
          return { tokenizer: tokenizer as unknown as Tokenizer, model: scorer as unknown as Scorer }
        },
      )
      encoder = loading
      // Allow a retry after a failed load instead of caching the rejection.
      loading.catch(() => {
        encoder = undefined
      })
    }
    return encoder
  }

  return {
    name: 'local',
    rerank: async ({ query, passages }) => {
      if (passages.length === 0) return { scores: {}, reranked: true }
      try {
        const { tokenizer, model: score } = await load()
        const inputs = tokenizer(
          passages.map(() => query),
          { text_pair: passages.map((p) => p.text), padding: true, truncation: true },
        )
        const rows = (await score(inputs)).logits.sigmoid().tolist()
        const scores: Record<string, number> = {}
        for (const [index, { id }] of passages.entries()) {
          const value = rows[index]?.[0]
          if (typeof value !== 'number' || !Number.isFinite(value)) return { reranked: false }
          scores[id] = value
        }
        return { scores, reranked: true }
      } catch {
        // Model missing, download blocked or inference error: search keeps the fused order.
        return { reranked: false }
      }
    },
  }
}
