'use client'

import { useState } from 'react'
import type { CreateWordPromptBody, PresenterWordPrompt } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { EmptyState } from '../ui/EmptyState'
import { ErrorState } from '../ui/ErrorState'
import { Icon } from '../ui/Icon'
import { LoadingState } from '../ui/LoadingState'
import { ScrollArea } from '../ui/ScrollArea'
import {
  badgeClass,
  button,
  itemCardClass,
  motionIn,
  summaryClass,
  switchThumbClass,
  switchTrackClass,
} from '../ui/styles'
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
        className={switchTrackClass}
      >
        <span
          aria-hidden="true"
          className={switchThumbClass(prompt.showCloud)}
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
      className={`${itemCardClass} ${motionIn}`}
    >
      <div className="flex flex-col gap-1">
        <span className="inline-flex w-fit items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-800">
          Open
        </span>
        <h3 className="text-base font-semibold break-words">{prompt.question}</h3>
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
              className={button('danger')}
            >
              <Icon name="check" />
              {busy ? 'Closing…' : 'Confirm'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className={button('secondary')}
            >
              <Icon name="x" />
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
            className={button('dangerSecondary')}
          >
            <Icon name="stop" />
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
        <summary className={`${summaryClass} inline-flex items-center gap-2`}>
          <Icon name="plus" />
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
        <LoadingState label="Loading word clouds" rows={2} />
      ) : null}

      {status === 'error' ? (
        <ErrorState message={loadError ?? 'We could not load the word clouds.'} onRetry={onRetry} />
      ) : null}

      {status === 'ready' && prompts.length === 0 ? (
        <EmptyState icon="chart" title="No word clouds yet">No word clouds yet. Create your first question.</EmptyState>
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
        <ScrollArea label="Other word clouds" maxHeightClass="max-h-[32rem]">
        <ul className="flex flex-col gap-3">
          {others.map((prompt) => (
            <li key={prompt.id} className={itemCardClass}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold break-words">{prompt.question}</h3>
                <span className={badgeClass}>
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
                      className={button('primary')}
                    >
                      <Icon name="play" />
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
        </ScrollArea>
      ) : null}
    </section>
  )
}
