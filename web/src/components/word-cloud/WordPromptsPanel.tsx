'use client'

import { useState } from 'react'
import type { CreateWordPromptBody, PresenterWordPrompt } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { CreateWordPromptForm } from './CreateWordPromptForm'
import { WordCloud, answersText } from './WordCloud'

export type WordPromptsPanelProps = {
  prompts: PresenterWordPrompt[]
  status: 'loading' | 'ready' | 'error'
  loadError?: string
  onRetry: () => void
  createPending: boolean
  createError?: string
  createFieldErrors?: Record<string, string>
  onCreate: (values: CreateWordPromptBody) => void
  busyPromptId?: string | null
  actionError?: string
  onOpen: (promptId: string) => void
  onClose: (promptId: string) => void
  onToggleCloud: (promptId: string, showCloud: boolean) => void
}

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50'

type CloudSwitchProps = {
  prompt: PresenterWordPrompt
  disabled: boolean
  onToggle: WordPromptsPanelProps['onToggleCloud']
}

function CloudSwitch({ prompt, disabled, onToggle }: CloudSwitchProps) {
  const id = `show-cloud-${prompt.id}`
  return (
    <div className="flex items-center gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={prompt.showCloud}
        disabled={disabled}
        onClick={() => onToggle(prompt.id, !prompt.showCloud)}
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-500 bg-white transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 aria-checked:bg-brand-600 disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-slate-600 shadow-sm transition-transform duration-150 motion-reduce:transition-none ${
            prompt.showCloud ? 'translate-x-6 bg-white' : 'translate-x-1'
          }`}
        />
      </button>
      <label htmlFor={id}>
        Show cloud to participants{' '}
        <span className="text-sm text-muted">({prompt.showCloud ? 'On' : 'Off'})</span>
      </label>
    </div>
  )
}

type OpenCardProps = {
  prompt: PresenterWordPrompt
  busy: boolean
  onClose: WordPromptsPanelProps['onClose']
  onToggleCloud: WordPromptsPanelProps['onToggleCloud']
}

function OpenCard({ prompt, busy, onClose, onToggleCloud }: OpenCardProps) {
  const [confirming, setConfirming] = useState(false)
  return (
    <article
      aria-label="Open word cloud"
      className="flex flex-col gap-4 rounded-2xl border border-line bg-white p-4"
    >
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
          Open
        </span>
        <h3 className="text-lg font-semibold break-words">{prompt.question}</h3>
      </div>
      <WordCloud cloud={prompt.cloud} />
      <CloudSwitch prompt={prompt} disabled={busy} onToggle={onToggleCloud} />
      {confirming ? (
        <div role="group" aria-label="Confirm closing the question" className="flex flex-col gap-3">
          <p>Close this question? Nobody can send a word afterwards.</p>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => onClose(prompt.id)}
              className={`${buttonClass} bg-danger-700 text-white enabled:hover:bg-danger-800 disabled:bg-slate-400`}
            >
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${buttonClass} border border-slate-300 bg-white enabled:hover:bg-slate-50`}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className={`${buttonClass} border border-danger-200 bg-white text-danger-700 enabled:hover:bg-danger-50`}
          >
            Close question
          </button>
        </div>
      )}
    </article>
  )
}

export function WordPromptsPanel({
  prompts,
  status,
  loadError,
  onRetry,
  createPending,
  createError,
  createFieldErrors,
  onCreate,
  busyPromptId = null,
  actionError,
  onOpen,
  onClose,
  onToggleCloud,
}: WordPromptsPanelProps) {
  const open = prompts.find((p) => p.status === 'ACTIVE')
  const others = prompts.filter((p) => p.status !== 'ACTIVE')

  return (
    <section aria-labelledby="word-prompts-heading" className="flex flex-col gap-4 text-left">
      <h2 id="word-prompts-heading" className="sr-only">
        Word cloud
      </h2>

      <details
        className="rounded-2xl border border-line bg-white p-4"
        open={prompts.length === 0 && status === 'ready'}
      >
        <summary className="cursor-pointer rounded-lg font-medium text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          Create a word cloud question
        </summary>
        <div className="pt-4">
          <CreateWordPromptForm
            pending={createPending}
            error={createError}
            fieldErrors={createFieldErrors}
            onSubmit={onCreate}
          />
        </div>
      </details>

      {actionError ? <StatusMessage kind="error">{actionError}</StatusMessage> : null}

      {status === 'loading' ? (
        <div role="status" aria-label="Loading word clouds" className="flex flex-col gap-3">
          <div className="h-6 w-2/3 animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
          <div className="h-40 w-full animate-pulse rounded-xl bg-slate-200 motion-reduce:animate-none" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{loadError ?? 'We could not load the word clouds.'}</StatusMessage>
          <div>
            <button
              type="button"
              onClick={onRetry}
              className={`${buttonClass} bg-brand-600 text-white enabled:hover:bg-brand-700`}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {status === 'ready' && prompts.length === 0 ? (
        <EmptyState>No word clouds yet. Create your first question.</EmptyState>
      ) : null}

      {status === 'ready' && open ? (
        <OpenCard
          prompt={open}
          busy={busyPromptId === open.id}
          onClose={onClose}
          onToggleCloud={onToggleCloud}
        />
      ) : null}

      {status === 'ready' && others.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {others.map((prompt) => (
            <li key={prompt.id} className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold break-words">{prompt.question}</h3>
                <span className="inline-flex w-fit items-center rounded-full border border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-semibold text-muted">
                  {prompt.status === 'DRAFT' ? 'Draft' : 'Closed'}
                </span>
              </div>
              {prompt.status === 'DRAFT' ? (
                <>
                  {open ? (
                    <p className="text-sm text-muted">
                      Another question is open. Opening this one will close it.
                    </p>
                  ) : null}
                  <div>
                    <button
                      type="button"
                      disabled={busyPromptId === prompt.id}
                      onClick={() => onOpen(prompt.id)}
                      className={`${buttonClass} bg-brand-600 text-white enabled:hover:bg-brand-700 disabled:bg-slate-400`}
                    >
                      {busyPromptId === prompt.id ? 'Opening…' : 'Open'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-muted">Final cloud: {answersText(prompt.cloud.total)}</p>
                  <WordCloud cloud={prompt.cloud} label={`Final cloud for ${prompt.question}`} />
                  <CloudSwitch
                    prompt={prompt}
                    disabled={busyPromptId === prompt.id}
                    onToggle={onToggleCloud}
                  />
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
