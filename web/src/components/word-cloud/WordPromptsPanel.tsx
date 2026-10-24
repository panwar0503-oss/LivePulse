'use client'

import { useState } from 'react'
import type { CreateWordPromptBody, PresenterWordPrompt } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
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
  'rounded px-4 py-2 font-medium focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 disabled:opacity-50'

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
        className="relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-slate-700 bg-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 aria-checked:bg-blue-700 disabled:opacity-50"
      >
        <span
          aria-hidden="true"
          className={`inline-block h-5 w-5 rounded-full bg-slate-700 transition-transform motion-reduce:transition-none ${
            prompt.showCloud ? 'translate-x-6 bg-white' : 'translate-x-1'
          }`}
        />
      </button>
      <label htmlFor={id}>
        Show cloud to participants{' '}
        <span className="text-sm text-slate-700">({prompt.showCloud ? 'On' : 'Off'})</span>
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
    <article aria-label="Open word cloud" className="flex flex-col gap-4 rounded border border-slate-500 p-4">
      <div className="flex flex-col gap-1">
        <span className="w-fit rounded border border-slate-700 px-2 py-0.5 text-sm font-semibold">Open</span>
        <h3 className="text-xl font-bold break-words">{prompt.question}</h3>
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
              className={`${buttonClass} bg-red-800 text-white disabled:bg-slate-400`}
            >
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={`${buttonClass} border border-slate-700`}
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
            className={`${buttonClass} border border-red-800 text-red-900`}
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
      <h2 id="word-prompts-heading" className="text-2xl font-bold">
        Word cloud
      </h2>

      <details
        className="rounded border border-slate-500 p-4"
        open={prompts.length === 0 && status === 'ready'}
      >
        <summary className="cursor-pointer font-medium focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700">
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
          <div className="h-6 w-2/3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
          <div className="h-40 w-full animate-pulse rounded bg-slate-200 motion-reduce:animate-none" />
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="flex flex-col gap-3">
          <StatusMessage kind="error">{loadError ?? 'We could not load the word clouds.'}</StatusMessage>
          <div>
            <button type="button" onClick={onRetry} className={`${buttonClass} bg-blue-700 text-white`}>
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {status === 'ready' && prompts.length === 0 ? (
        <p>No word clouds yet. Create your first question.</p>
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
            <li key={prompt.id} className="flex flex-col gap-3 rounded border border-slate-500 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold break-words">{prompt.question}</h3>
                <span className="rounded border border-slate-700 px-2 py-0.5 text-sm font-semibold">
                  {prompt.status === 'DRAFT' ? 'Draft' : 'Closed'}
                </span>
              </div>
              {prompt.status === 'DRAFT' ? (
                <>
                  {open ? (
                    <p className="text-sm text-slate-700">
                      Another question is open. Opening this one will close it.
                    </p>
                  ) : null}
                  <div>
                    <button
                      type="button"
                      disabled={busyPromptId === prompt.id}
                      onClick={() => onOpen(prompt.id)}
                      className={`${buttonClass} bg-blue-700 text-white disabled:bg-slate-400`}
                    >
                      {busyPromptId === prompt.id ? 'Opening…' : 'Open'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-sm text-slate-700">Final cloud: {answersText(prompt.cloud.total)}</p>
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
