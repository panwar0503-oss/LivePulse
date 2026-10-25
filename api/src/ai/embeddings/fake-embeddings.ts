import { EMBEDDING_DIM } from '@livepulse/shared'
import type { EmbeddingsProvider } from './embeddings-provider.js'

// FNV-1a: a simple, stable string hash used only to seed the generator.
const hashText = (text: string): number => {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

// mulberry32 PRNG: deterministic floats in [0, 1).
const createRandom = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const vectorFor = (text: string, dimension: number): number[] => {
  const random = createRandom(hashText(text))
  const raw = Array.from({ length: dimension }, () => random() - 0.5)
  const norm = Math.sqrt(raw.reduce((sum, v) => sum + v * v, 0))
  // A zero vector is practically impossible, but never divide by zero.
  return norm === 0 ? raw.map((_, i) => (i === 0 ? 1 : 0)) : raw.map((v) => v / norm)
}

export const createFakeEmbeddings = (dimension: number = EMBEDDING_DIM): EmbeddingsProvider => ({
  name: 'fake',
  model: 'fake',
  dimension,
  embed: (texts) => Promise.resolve(texts.map((text) => vectorFor(text, dimension))),
})
