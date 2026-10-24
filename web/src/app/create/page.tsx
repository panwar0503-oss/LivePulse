'use client'

import { useState } from 'react'
import type { CreatedSession, CreateSessionBody } from '@livepulse/shared'
import { CreateForm } from '../../components/sessions/CreateForm'
import { SessionCreatedPanel } from '../../components/sessions/SessionCreatedPanel'
import { createSession } from '../../lib/api/sessions'

export default function CreatePage() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>()
  // Held in memory only: shown in place, once, and never persisted or put in the URL.
  const [created, setCreated] = useState<CreatedSession | null>(null)

  const handleSubmit = async (values: CreateSessionBody): Promise<void> => {
    setPending(true)
    setError(undefined)
    setFieldErrors(undefined)
    const result = await createSession(values)
    setPending(false)
    if (result.ok) {
      setCreated(result.data)
      return
    }
    setFieldErrors(result.fields)
    setError(
      result.code === 'RATE_LIMITED'
        ? 'Too many sessions created. Please wait a while and try again.'
        : result.message,
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold">Create a session</h1>
      {created ? (
        <SessionCreatedPanel session={created} />
      ) : (
        <CreateForm
          pending={pending}
          error={error}
          fieldErrors={fieldErrors}
          onSubmit={(values) => void handleSubmit(values)}
        />
      )}
    </main>
  )
}
