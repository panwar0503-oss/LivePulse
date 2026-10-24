'use client'

import { useState } from 'react'
import type { CreateWordPromptBody, PresenterWordPrompt } from '@livepulse/shared'
import { usePresenterWordPrompts } from '../../hooks/use-presenter-word-prompts'
import {
  closeWordPrompt,
  createWordPrompt,
  openWordPrompt,
  updateWordPrompt,
} from '../../lib/api/word-prompts'
import type { ApiResult } from '../../lib/api/sessions'
import { wordPromptErrorMessage } from './word-messages'
import { WordPromptsPanel } from './WordPromptsPanel'

export type PresenterWordPromptsProps = { sessionId: string }

// Connects the word cloud panel to the API; every change is re-read so the list matches the server.
export function PresenterWordPrompts({ sessionId }: PresenterWordPromptsProps) {
  const { prompts, status, refresh, error } = usePresenterWordPrompts(sessionId)
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>()
  const [createFields, setCreateFields] = useState<Record<string, string> | undefined>()
  const [busyPromptId, setBusyPromptId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | undefined>()

  const handleCreate = async (values: CreateWordPromptBody): Promise<void> => {
    setCreatePending(true)
    setCreateError(undefined)
    setCreateFields(undefined)
    const result = await createWordPrompt(sessionId, values)
    setCreatePending(false)
    if (result.ok) {
      refresh()
      return
    }
    setCreateFields(result.fields)
    setCreateError(wordPromptErrorMessage(result.code, result.message))
  }

  const act = async (promptId: string, run: () => Promise<ApiResult<PresenterWordPrompt>>): Promise<void> => {
    setBusyPromptId(promptId)
    setActionError(undefined)
    const result = await run()
    setBusyPromptId(null)
    if (!result.ok) setActionError(wordPromptErrorMessage(result.code, result.message))
    refresh()
  }

  return (
    <WordPromptsPanel
      prompts={prompts}
      status={status}
      loadError={error?.message}
      onRetry={refresh}
      createPending={createPending}
      createError={createError}
      createFieldErrors={createFields}
      onCreate={(values) => void handleCreate(values)}
      busyPromptId={busyPromptId}
      actionError={actionError}
      onOpen={(id) => void act(id, () => openWordPrompt(id))}
      onClose={(id) => void act(id, () => closeWordPrompt(id))}
      onToggleCloud={(id, showCloud) => void act(id, () => updateWordPrompt(id, { showCloud }))}
    />
  )
}
