import { describe, expect, it } from 'vitest'
import { EMBEDDING_DIM } from '@livepulse/shared'
import { createLocalEmbeddings } from '../../src/ai/embeddings/local-embeddings.js'

// Opt-in: the first run downloads the model (about 23 MB) into api/.cache/models. Runs only with AI_LIVE_TEST=1.
describe.runIf(process.env.AI_LIVE_TEST === '1')('local embeddings live', () => {
  it('loads the local model and returns vectors of EMBEDDING_DIM', async () => {
    const provider = createLocalEmbeddings({
      model: 'Xenova/all-MiniLM-L6-v2',
      dimension: EMBEDDING_DIM,
    })

    const [vector] = await provider.embed(['live embedding check'])

    expect(vector).toHaveLength(EMBEDDING_DIM)
  }, 300_000)
})
