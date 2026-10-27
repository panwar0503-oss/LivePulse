'use client'

import { useRef, useState, type FormEvent, type RefObject } from 'react'
import type { ChatTurn } from '@livepulse/shared'
import { useReportChat, type LiveAnswer } from '../../hooks/use-report-chat'
import { StatusMessage } from '../sessions/StatusMessage'
import { Card } from '../ui/Card'
import { EmptyState } from '../ui/EmptyState'
import { badgeClass, button, hintClass, inputClass, labelClass, skeletonClass } from '../ui/styles'
import {
  QUESTION_MAX,
  announcement,
  counterText,
  sourceChipText,
  toolProgress,
  type StreamPhase,
} from './report-chat-copy'

export type ReportChatViewProps = {
  turns: ChatTurn[]
  loading: boolean
  loadError: string | null
  live: LiveAnswer | null
  phase: StreamPhase
  notice: string | null
  question: string
  inputRef?: RefObject<HTMLInputElement | null>
  onQuestionChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onAskAgain: (question: string) => void
  onRetryLoad: () => void
}

function TurnView({
  turn,
  busy,
  onAskAgain,
}: {
  turn: ChatTurn
  busy: boolean
  onAskAgain: (q: string) => void
}) {
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
      <p className="font-medium text-ink">
        <span className="sr-only">Question: </span>
        {turn.question}
      </p>
      {turn.status === 'STREAMING' ? <p className={hintClass}>Writing…</p> : null}
      {turn.answer ? <p className="whitespace-pre-wrap text-ink">{turn.answer}</p> : null}
      {turn.status === 'INCOMPLETE' ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className={badgeClass}>Answer stopped early</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onAskAgain(turn.question)}
            className={button('secondary', 'sm')}
          >
            Ask again
          </button>
        </div>
      ) : null}
      {turn.sources.length > 0 ? (
        <ul aria-label="Sources" className="flex flex-wrap gap-2">
          {turn.sources.map((source) => (
            <li key={`${source.kind}:${source.ref}`} className={badgeClass}>
              {sourceChipText(source)}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

// Answers are plain React text; the server sends no HTML and none is interpreted.
export function ReportChatView(props: ReportChatViewProps) {
  const { turns, live, phase, question } = props
  const busy = live !== null
  const counter = counterText(question.length)
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!busy && question.trim().length > 0) props.onSend()
  }

  return (
    <Card title="Ask your session" headingLevel={3}>
      {props.loading ? (
        <div role="status" className="flex flex-col gap-2">
          <p className={hintClass}>Loading earlier questions…</p>
          <div className={`h-16 w-full ${skeletonClass}`} />
        </div>
      ) : null}

      {props.loadError ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{props.loadError}</StatusMessage>
          <div>
            <button type="button" onClick={props.onRetryLoad} className={button('primary')}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {!props.loading && !props.loadError && turns.length === 0 && !live ? (
        <EmptyState>Ask a question about your polls, word clouds, Q&amp;A or documents.</EmptyState>
      ) : null}

      {turns.length > 0 ? (
        <ol aria-label="Chat history" className="flex flex-col gap-3">
          {turns.map((turn) => (
            <TurnView key={turn.id} turn={turn} busy={busy} onAskAgain={props.onAskAgain} />
          ))}
        </ol>
      ) : null}

      {live ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
          <p className="font-medium text-ink">
            <span className="sr-only">Question: </span>
            {live.question}
          </p>
          {live.text ? <p className="whitespace-pre-wrap text-ink">{live.text}</p> : null}
          {live.tool ? <p className={hintClass}>{toolProgress(live.tool)}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <span className={hintClass}>Writing…</span>
            <button type="button" onClick={props.onStop} className={button('secondary', 'sm')}>
              Stop
            </button>
          </div>
        </div>
      ) : null}

      {/* Announced on start and on done only, never per token. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement(phase)}
      </p>

      {props.notice ? <StatusMessage kind="info">{props.notice}</StatusMessage> : null}

      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor="report-chat-question" className={labelClass}>
          Your question
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="report-chat-question"
            ref={props.inputRef}
            type="text"
            maxLength={QUESTION_MAX}
            value={question}
            onChange={(event) => props.onQuestionChange(event.target.value)}
            className={inputClass}
          />
          <button type="submit" disabled={busy || question.trim().length === 0} className={button('primary')}>
            Send
          </button>
        </div>
        {counter ? <p className={hintClass}>{counter}</p> : null}
      </form>
    </Card>
  )
}

export type ReportChatProps = { sessionId: string }

export function ReportChat({ sessionId }: ReportChatProps) {
  const chat = useReportChat(sessionId)
  const [question, setQuestion] = useState('')
  const inputRef = useRef<HTMLInputElement | null>(null)

  const send = (text: string, clear: boolean): void => {
    void chat.ask(text, clear ? () => setQuestion('') : undefined)
    inputRef.current?.focus()
  }

  return (
    <ReportChatView
      turns={chat.turns}
      loading={chat.loading}
      loadError={chat.loadError}
      live={chat.live}
      phase={chat.phase}
      notice={chat.notice}
      question={question}
      inputRef={inputRef}
      onQuestionChange={setQuestion}
      onSend={() => send(question.trim(), true)}
      onStop={chat.abort}
      onAskAgain={(text) => send(text, false)}
      onRetryLoad={chat.reload}
    />
  )
}
