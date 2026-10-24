'use client'

import { useState } from 'react'
import { useParticipantWordPrompt } from '../../hooks/use-participant-word-prompt'
import { submitWord } from '../../lib/api/word-prompts'
import { submitWordErrorMessage } from './word-messages'
import { ParticipantWordPrompt } from './ParticipantWordPrompt'

export type LiveParticipantWordPromptProps = { roomCode: string }

// Connects the word view to the API; a refused send is re-read so the screen shows the stored word.
export function LiveParticipantWordPrompt({ roomCode }: LiveParticipantWordPromptProps) {
  const { prompt, status, refresh, error } = useParticipantWordPrompt(roomCode)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState<string | undefined>()

  const handleSubmit = async (text: string): Promise<void> => {
    if (!prompt) return
    setPending(true)
    setSubmitError(undefined)
    const result = await submitWord(prompt.id, text)
    setPending(false)
    if (!result.ok) {
      setSubmitError(submitWordErrorMessage(result.code, result.fields?.text))
    }
    refresh()
  }

  return (
    <ParticipantWordPrompt
      prompt={prompt}
      status={status}
      loadError={error?.message}
      onRetry={refresh}
      pending={pending}
      submitError={submitError}
      onSubmit={(text) => void handleSubmit(text)}
    />
  )
}
