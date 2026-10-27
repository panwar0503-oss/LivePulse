import { z } from 'zod'
import type { SessionReport } from '@livepulse/shared'
import { escapeForPrompt } from '../tasks/qna-copilot/prompts.js'

export const TOOL_LIMITS = { rows: 20, textChars: 200, resultChars: 4000 } as const

export type ToolOutcome =
  { ok: true; result: Record<string, unknown>; sources: string[] } | { ok: false; error: string }

type Entry = { row: Record<string, unknown>; source: string }

const text = (value: string): string => value.slice(0, TOOL_LIMITS.textChars)

// Builds the bounded result: rows are capped, then dropped from the end until the JSON fits the character cap.
// A row and its source are dropped together, so a source always points at a row the model could see.
function finish(
  extra: Record<string, unknown>,
  entries: readonly Entry[],
  extraSources: readonly string[] = [],
): Extract<ToolOutcome, { ok: true }> {
  const kept = entries.slice(0, TOOL_LIMITS.rows)
  const build = (): Extract<ToolOutcome, { ok: true }> => ({
    ok: true,
    result: { ...extra, rows: kept.map((e) => e.row) },
    sources: [...extraSources, ...kept.map((e) => e.source)],
  })
  let outcome = build()
  while (kept.length > 0 && JSON.stringify(outcome.result).length > TOOL_LIMITS.resultChars) {
    kept.pop()
    outcome = build()
  }
  return outcome
}

const noInput = z.object({}).strict()
const topWordsInput = z.object({ promptId: z.string().uuid().optional() }).strict()

interface Tool<S extends z.ZodType> {
  name: string
  description: string
  input: S
  run: (report: SessionReport, input: z.infer<S>) => ToolOutcome
}

function defineTool<S extends z.ZodType>(tool: Tool<S>): Tool<S> {
  return tool
}

const getPollResults = defineTool({
  name: 'get_poll_results',
  description: 'Results of every poll in this session: question, status, total votes, and votes per option.',
  input: noInput,
  run: (report) =>
    finish(
      { count: report.polls.length },
      report.polls.map((p) => ({
        source: `poll:${p.id}`,
        row: {
          question: text(p.question),
          status: p.status,
          totalVotes: p.total,
          options: p.options
            .slice(0, TOOL_LIMITS.rows)
            .map((o) => ({ label: text(o.label), votes: o.count, percent: o.pct })),
        },
      })),
    ),
})

const getTopWords = defineTool({
  name: 'get_top_words',
  description:
    'Most common words for the session word prompts. Optionally pass promptId (a uuid from this tool result) for one prompt.',
  input: topWordsInput,
  run: (report, input) => {
    const prompts = input.promptId
      ? report.wordPrompts.filter((p) => p.id === input.promptId)
      : report.wordPrompts
    if (input.promptId && prompts.length === 0)
      return { ok: false, error: 'Unknown promptId for this session.' }
    return finish(
      { count: prompts.length },
      prompts.map((p) => ({
        source: `prompt:${p.id}`,
        row: {
          promptId: p.id,
          prompt: text(p.prompt),
          totalResponses: p.total,
          topWords: p.top.map((w) => ({ word: text(w.word), count: w.count })),
        },
      })),
    )
  },
})

const getTopQuestions = defineTool({
  name: 'get_top_questions',
  description: 'The most upvoted visible audience questions, with upvotes and whether each was answered.',
  input: noInput,
  run: (report) =>
    finish(
      {},
      report.questions.top.map((q) => ({
        source: `question:${q.id}`,
        row: { text: text(q.text), upvotes: q.upvotes, answered: q.answered },
      })),
    ),
})

const getQuestionCounts = defineTool({
  name: 'get_question_counts',
  description: 'Totals for audience questions: all, answered, unanswered and hidden.',
  input: noInput,
  run: (report) => {
    const { total, answered, unanswered, hidden } = report.questions
    return finish({ total, answered, unanswered, hidden }, [])
  },
})

const getDocuments = defineTool({
  name: 'get_documents',
  description:
    'Knowledge documents of the session. After the session ends they are removed; only the processed count remains.',
  input: noInput,
  run: (report) =>
    finish(
      {
        removedAtEnd: report.documents.removedAtEnd,
        processedCount: report.documents.processedCount ?? 0,
      },
      report.documents.items.map((d) => ({
        source: `document:${d.id}`,
        row: { fileName: text(d.fileName), status: d.status },
      })),
    ),
})

const getAiUsage = defineTool({
  name: 'get_ai_usage',
  description: 'AI tokens used against the session budget, in total and per AI task.',
  input: noInput,
  run: (report) =>
    finish(
      { tokensUsed: report.aiUsage.tokensUsed, tokenBudget: report.aiUsage.tokenBudget },
      report.aiUsage.byTask.map((t) => ({
        source: 'ai-usage',
        row: { task: text(t.taskName), jobs: t.jobs, tokens: t.tokens },
      })),
      ['ai-usage'],
    ),
})

// Typed loosely at the list level on purpose: each tool's input is parsed by its own schema before run.
interface AnyTool {
  name: string
  description: string
  input: z.ZodType
  run: (report: SessionReport, input: never) => ToolOutcome
}

export const SESSION_TOOLS: readonly AnyTool[] = [
  getPollResults,
  getTopWords,
  getTopQuestions,
  getQuestionCounts,
  getDocuments,
  getAiUsage,
]

export function runTool(report: SessionReport, name: string, rawInput: unknown): ToolOutcome {
  const tool = SESSION_TOOLS.find((t) => t.name === name)
  if (!tool) return { ok: false, error: 'Unknown tool.' }
  const parsed = tool.input.safeParse(rawInput ?? {})
  if (!parsed.success) return { ok: false, error: 'Invalid tool input.' }
  const outcome = tool.run(report, parsed.data as never)
  return outcome.ok ? { ...outcome, sources: [...new Set(outcome.sources)] } : outcome
}

/** What the model sees: escaped so the data cannot close the wrapper. */
export function wrapToolOutcome(name: string, outcome: ToolOutcome): string {
  const body = outcome.ok ? JSON.stringify(outcome.result) : JSON.stringify({ error: outcome.error })
  return `<session_data tool="${escapeForPrompt(name)}">${escapeForPrompt(body)}</session_data>`
}
