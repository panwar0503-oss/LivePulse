/**
 * Q&A copilot graph: one node per step, no checkpointer. The table is the checkpoint: the task reads the
 * question's `ai_step` and START routes there, so a recovered job resumes where the last commit left it.
 * Graph state carries ids, the step, the English query and its language, plus the outcome and token totals;
 * never passages or answer text.
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { AiProviderError } from '../../providers/llm-provider.js'
import {
  DONE_STEP,
  awaitPresenter,
  dedupe,
  draft,
  embed,
  moderate,
  retrieve,
  selfCheck,
  type CopilotInput,
  type CopilotNodeDeps,
  type CopilotNodeResult,
  type CopilotOutcome,
  type CopilotStep,
} from './nodes.js'

export const COPILOT_STEPS: readonly CopilotStep[] = [
  'moderate',
  'embed',
  'dedupe',
  'retrieve',
  'draft',
  'selfCheck',
  'awaitPresenter',
]

const isStep = (value: unknown): value is CopilotStep =>
  typeof value === 'string' && (COPILOT_STEPS as readonly string[]).includes(value)

const sum = (a: number, b: number): number => a + b

export const CopilotState = Annotation.Root({
  questionId: Annotation<string>,
  sessionId: Annotation<string>,
  jobId: Annotation<string | null>,
  // The next node to run, or DONE_STEP once a node reached a terminal outcome.
  step: Annotation<string | null>,
  englishQuery: Annotation<string | undefined>,
  language: Annotation<string | undefined>,
  outcome: Annotation<CopilotOutcome | undefined>,
  draftId: Annotation<string | undefined>,
  inputTokens: Annotation<number>({ reducer: sum, default: () => 0 }),
  outputTokens: Annotation<number>({ reducer: sum, default: () => 0 }),
})

export type CopilotGraphState = typeof CopilotState.State

/** START: the step the question has reached (read from the database); nothing to run → END. */
export function routeFromStart(state: Pick<CopilotGraphState, 'step'>): CopilotStep | typeof END {
  return isStep(state.step) ? state.step : END
}

// Where each node may lead. draft → draft is the retry of a draft that cited nothing; selfCheck → draft is the
// retry after an unsupported draft. Both are bounded by draft_attempts in the database (MAX_DRAFT_ATTEMPTS).
const NEXT: Record<CopilotStep, readonly CopilotStep[]> = {
  moderate: ['embed'],
  embed: ['dedupe'],
  dedupe: ['retrieve'],
  retrieve: ['draft'],
  draft: ['selfCheck', 'draft'],
  selfCheck: ['awaitPresenter', 'draft'],
  awaitPresenter: [],
}

const routeAfter =
  (from: CopilotStep) =>
  (state: Pick<CopilotGraphState, 'step'>): CopilotStep | typeof END => {
    if (state.step === DONE_STEP) return END
    if (isStep(state.step) && NEXT[from].includes(state.step)) return state.step
    // A node returned a step this graph does not allow: a programming error, never retried.
    throw new AiProviderError('INTERNAL', false)
  }

type Node = (deps: CopilotNodeDeps, input: CopilotInput) => Promise<CopilotNodeResult>

const asGraphNode =
  (deps: CopilotNodeDeps, node: Node) =>
  async (state: CopilotGraphState): Promise<Partial<CopilotGraphState>> => {
    const result = await node(deps, {
      questionId: state.questionId,
      sessionId: state.sessionId,
      jobId: state.jobId,
      englishQuery: state.englishQuery,
      language: state.language,
    })
    const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
    if (result.kind === 'next') {
      return {
        ...usage,
        step: result.step,
        englishQuery: result.carry.englishQuery ?? state.englishQuery,
        language: result.carry.language ?? state.language,
      }
    }
    return { ...usage, step: DONE_STEP, outcome: result.outcome, draftId: result.draftId }
  }

// Built per run so the node deps (provider, signal, emit) stay in the closure, not in graph state.
// Not exported: its return type is LangGraph's inferred compiled-graph type.
function buildCopilotGraph(deps: CopilotNodeDeps) {
  return new StateGraph(CopilotState)
    .addNode('moderate', asGraphNode(deps, moderate))
    .addNode('embed', asGraphNode(deps, embed))
    .addNode('dedupe', asGraphNode(deps, dedupe))
    .addNode('retrieve', asGraphNode(deps, retrieve))
    .addNode('draft', asGraphNode(deps, draft))
    .addNode('selfCheck', asGraphNode(deps, selfCheck))
    .addNode('awaitPresenter', asGraphNode(deps, awaitPresenter))
    .addConditionalEdges(START, routeFromStart, [...COPILOT_STEPS, END])
    .addConditionalEdges('moderate', routeAfter('moderate'), ['embed', END])
    .addConditionalEdges('embed', routeAfter('embed'), ['dedupe', END])
    .addConditionalEdges('dedupe', routeAfter('dedupe'), ['retrieve', END])
    .addConditionalEdges('retrieve', routeAfter('retrieve'), ['draft', END])
    .addConditionalEdges('draft', routeAfter('draft'), ['selfCheck', 'draft', END])
    .addConditionalEdges('selfCheck', routeAfter('selfCheck'), ['awaitPresenter', 'draft', END])
    .addConditionalEdges('awaitPresenter', routeAfter('awaitPresenter'), [END])
    .compile()
}

// Longest path: 7 nodes plus two draft retries; the bound only guards against a routing bug.
const RECURSION_LIMIT = 20

export async function runCopilotGraph(
  deps: CopilotNodeDeps,
  start: Pick<CopilotGraphState, 'questionId' | 'sessionId' | 'jobId' | 'step' | 'englishQuery' | 'language'>,
): Promise<CopilotGraphState> {
  return buildCopilotGraph(deps).invoke(start, { signal: deps.signal, recursionLimit: RECURSION_LIMIT })
}
