'use client'

import { useState, type ReactNode } from 'react'
import type { SessionReport as SessionReportData } from '@livepulse/shared'
import { downloadReport } from '../../lib/api/report-client'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { LoadingState } from '../ui/LoadingState'
import { StatusPill } from '../ui/StatusPill'
import { badgeClass, button, fieldErrorClass, hintClass, itemCardClass } from '../ui/styles'

export const REPORT_EMPTY_MESSAGE = 'Nothing has been recorded in this session yet.'
export const REPORT_DOCUMENTS_REMOVED = 'Documents are removed when the session ends.'
export const REPORT_LIVE_NOTE = 'Live — updates as the session runs'
export const REPORT_FINAL_NOTE = 'Final'

export type SessionReportProps = {
  sessionId: string
  report: SessionReportData | null
  status: 'loading' | 'error' | 'ready'
  error: { message: string } | null
  onRetry: () => void
}

const formatTime = (iso: string): string => new Date(iso).toLocaleString()

const th = 'py-1 pr-3 text-left text-sm font-semibold'
const td = 'py-1 pr-3 align-top break-words'

function Pct({ pct, count, total }: { pct: number; count: number; total: number }) {
  return (
    <>
      <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-slate-200">
        <span
          className="block h-full rounded-full bg-brand-600"
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </span>
      <span className="text-sm">
        {count} of {total} {total === 1 ? 'vote' : 'votes'} ({Math.round(pct)}%)
      </span>
    </>
  )
}

function ExportButton({ sessionId }: { sessionId: string }) {
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const run = (): void => {
    setBusy(true)
    setFailure(null)
    void downloadReport(sessionId).then((result) => {
      setBusy(false)
      if (!result.ok) setFailure(result.message)
    })
  }
  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className={button('secondary')} disabled={busy} onClick={run}>
        Export report
      </button>
      {failure === null ? null : (
        <p role="alert" className={fieldErrorClass}>
          {failure}
        </p>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card title={title} headingLevel={2}>
      {children}
    </Card>
  )
}

const isEmpty = (r: SessionReportData): boolean =>
  r.polls.length === 0 &&
  r.wordPrompts.length === 0 &&
  r.questions.total === 0 &&
  r.questions.hidden === 0 &&
  r.documents.items.length === 0 &&
  (r.documents.processedCount ?? 0) === 0 &&
  r.aiUsage.tokensUsed === 0

export function SessionReport({ sessionId, report, status, error, onRetry }: SessionReportProps) {
  if (status === 'loading' && report === null) return <LoadingState label="Loading report…" />
  if (report === null) {
    return <ErrorState message={error?.message ?? 'The report could not be loaded.'} onRetry={onRetry} />
  }

  const { session, questions, documents, aiUsage } = report
  const ended = session.status === 'ENDED'

  return (
    <div className="flex flex-col gap-4">
      <Card
        title={session.title}
        actions={<ExportButton sessionId={sessionId} />}
        description={<span role="status">{report.final ? REPORT_FINAL_NOTE : REPORT_LIVE_NOTE}</span>}
      >
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill tone={ended ? 'ended' : 'live'}>{ended ? 'Ended' : 'Live'}</StatusPill>
          {session.endedAt === null ? null : (
            <span className={hintClass}>Ended {formatTime(session.endedAt)}</span>
          )}
        </div>
        {error === null ? null : (
          <p role="alert" className={fieldErrorClass}>
            {error.message}{' '}
            <button type="button" className="underline" onClick={onRetry}>
              Try again
            </button>
          </p>
        )}
      </Card>

      {isEmpty(report) ? (
        <EmptyState icon="chart" title="Nothing to report yet">
          {REPORT_EMPTY_MESSAGE}
        </EmptyState>
      ) : (
        <>
          <Section title="Polls">
            {report.polls.length === 0 ? (
              <p className={hintClass}>No polls were run.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {report.polls.map((poll) => (
                  <li key={poll.id} className={itemCardClass}>
                    <p className="font-semibold break-words">{poll.question}</p>
                    <p className={hintClass}>
                      <span className={badgeClass}>{poll.status}</span> {poll.total}{' '}
                      {poll.total === 1 ? 'vote' : 'votes'} in total
                    </p>
                    <ul className="flex flex-col gap-2">
                      {poll.options.map((o, i) => (
                        <li key={`${i}-${o.label}`} className="flex flex-col gap-1">
                          <span className="break-words">{o.label}</span>
                          <Pct pct={o.pct} count={o.count} total={poll.total} />
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Word prompts">
            {report.wordPrompts.length === 0 ? (
              <p className={hintClass}>No word prompts were run.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {report.wordPrompts.map((p) => (
                  <li key={p.id} className={itemCardClass}>
                    <p className="font-semibold break-words">{p.prompt}</p>
                    <p className={hintClass}>{p.total} words in total</p>
                    {p.top.length === 0 ? null : (
                      <table className="w-full">
                        <caption className="sr-only">Top words for {p.prompt}</caption>
                        <thead>
                          <tr>
                            <th scope="col" className={th}>
                              Word
                            </th>
                            <th scope="col" className={th}>
                              Count
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {p.top.map((w) => (
                            <tr key={w.word}>
                              <td className={td}>{w.word}</td>
                              <td className={td}>{w.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Questions">
            <p>
              {questions.total} in total: {questions.answered} answered, {questions.unanswered} unanswered,{' '}
              {questions.hidden} hidden.
            </p>
            {questions.top.length === 0 ? null : (
              <table className="w-full">
                <caption className="sr-only">Top questions</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>
                      Question
                    </th>
                    <th scope="col" className={th}>
                      Upvotes
                    </th>
                    <th scope="col" className={th}>
                      Answered
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {questions.top.map((q) => (
                    <tr key={q.id}>
                      <td className={td}>{q.text}</td>
                      <td className={td}>{q.upvotes}</td>
                      <td className={td}>{q.answered ? 'Answered' : 'Not answered'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Documents">
            {documents.removedAtEnd ? (
              <>
                <p>{REPORT_DOCUMENTS_REMOVED}</p>
                <p>
                  {documents.processedCount ?? 0}{' '}
                  {(documents.processedCount ?? 0) === 1 ? 'document was' : 'documents were'} processed.
                </p>
              </>
            ) : documents.items.length === 0 ? (
              <p className={hintClass}>No documents have been added.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {documents.items.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <span className="break-words">{d.fileName}</span>
                    <span className={badgeClass}>{d.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="AI usage">
            <p>
              {aiUsage.tokensUsed} of {aiUsage.tokenBudget} tokens used (
              {Math.round((aiUsage.tokensUsed / aiUsage.tokenBudget) * 100)}% of the budget).
            </p>
            {aiUsage.byTask.length === 0 ? null : (
              <table className="w-full">
                <caption className="sr-only">AI usage by task</caption>
                <thead>
                  <tr>
                    <th scope="col" className={th}>
                      Task
                    </th>
                    <th scope="col" className={th}>
                      Jobs
                    </th>
                    <th scope="col" className={th}>
                      Tokens
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {aiUsage.byTask.map((t) => (
                    <tr key={t.type}>
                      <td className={td}>{t.taskName}</td>
                      <td className={td}>{t.jobs}</td>
                      <td className={td}>{t.tokens}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  )
}
