import type { Env } from '../../config/env.js'
import { createFakeReranker } from './fake-reranker.js'
import { createLocalReranker } from './local-reranker.js'
import type { Reranker } from './reranker.js'

export const createReranker = (env: Pick<Env, 'RERANKER_PROVIDER' | 'RERANKER_MODEL'>): Reranker =>
  env.RERANKER_PROVIDER === 'fake' ? createFakeReranker() : createLocalReranker({ model: env.RERANKER_MODEL })

export { createFakeReranker } from './fake-reranker.js'
export type { RerankInput, Reranker, RerankResult } from './reranker.js'
