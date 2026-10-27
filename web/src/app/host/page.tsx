'use client'

import { useState } from 'react'
import type { CreatedSession, CreateSessionBody } from '@livepulse/shared'
import { CreateForm } from '../../components/sessions/CreateForm'
import { SessionCreatedPanel } from '../../components/sessions/SessionCreatedPanel'
import { AppShell } from '../../components/ui/AppShell'
import { panelClass } from '../../components/ui/styles'
import { createSession } from '../../lib/api/sessions'

export default function CreatePage() {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>()
  // Held in memory only: shown in place, once, and never persisted or put in the URL.
  const [created, setCreated] = useState<{ session: CreatedSession; title: string } | null>(null)

  const handleSubmit = async (values: CreateSessionBody): Promise<void> => {
    setPending(true)
    setError(undefined)
    setFieldErrors(undefined)
    const result = await createSession(values)
    setPending(false)
    if (result.ok) {
      setCreated({ session: result.data, title: values.title })
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
    <AppShell>
      <div className={panelClass}>
        {created ? (
          <SessionCreatedPanel session={created.session} title={created.title} />
        ) : (
          <CreateForm
            pending={pending}
            error={error}
            fieldErrors={fieldErrors}
            onSubmit={(values) => void handleSubmit(values)}
          />
        )}
      </div>
    </AppShell>
  )
}
