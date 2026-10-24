'use client'

import { useState } from 'react'
import type { CreatePollBody, PresenterPoll } from '@livepulse/shared'
import { usePresenterPolls } from '../../hooks/use-presenter-polls'
import { closePoll, createPoll, startPoll, updatePoll } from '../../lib/api/polls'
import type { ApiResult } from '../../lib/api/sessions'
import { pollErrorMessage } from './poll-messages'
import { PollsPanel } from './PollsPanel'

export type PresenterPollsProps = { sessionId: string }

// Connects the polls panel to the API; every change is re-read so the list matches the server.
export function PresenterPolls({ sessionId }: PresenterPollsProps) {
  const { polls, status, refresh, error } = usePresenterPolls(sessionId)
  const [createPending, setCreatePending] = useState(false)
  const [createError, setCreateError] = useState<string | undefined>()
  const [createFields, setCreateFields] = useState<Record<string, string> | undefined>()
  const [busyPollId, setBusyPollId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | undefined>()

  const handleCreate = async (values: CreatePollBody): Promise<void> => {
    setCreatePending(true)
    setCreateError(undefined)
    setCreateFields(undefined)
    const result = await createPoll(sessionId, values)
    setCreatePending(false)
    if (result.ok) {
      refresh()
      return
    }
    setCreateFields(result.fields)
    setCreateError(pollErrorMessage(result.code, result.message))
  }

  const act = async (pollId: string, run: () => Promise<ApiResult<PresenterPoll>>): Promise<void> => {
    setBusyPollId(pollId)
    setActionError(undefined)
    const result = await run()
    setBusyPollId(null)
    if (!result.ok) setActionError(pollErrorMessage(result.code, result.message))
    refresh()
  }

  return (
    <PollsPanel
      polls={polls}
      status={status}
      loadError={error?.message}
      onRetry={refresh}
      createPending={createPending}
      createError={createError}
      createFieldErrors={createFields}
      onCreate={(values) => void handleCreate(values)}
      busyPollId={busyPollId}
      actionError={actionError}
      onStart={(id) => void act(id, () => startPoll(id))}
      onClose={(id) => void act(id, () => closePoll(id))}
      onToggleResults={(id, showResults) => void act(id, () => updatePoll(id, { showResults }))}
    />
  )
}
