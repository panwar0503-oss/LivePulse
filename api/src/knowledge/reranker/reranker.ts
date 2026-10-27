export interface RerankInput {
  query: string
  passages: { id: string; text: string }[]
}

// reranked:false means "keep the fused order": the caller never fails a search because of the reranker.
export type RerankResult = { scores: Record<string, number>; reranked: true } | { reranked: false }

export interface Reranker {
  name: 'fake' | 'local'
  rerank(input: RerankInput): Promise<RerankResult>
}
