'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { roomCodeSchema } from '@livepulse/shared'
import { JoinForm } from '../../components/sessions/JoinForm'
import { joinSession } from '../../lib/api/sessions'

// A bad ?code= is dropped rather than shown, so the field simply starts empty.
export const sanitiseCode = (raw: string | null): string => {
  const parsed = roomCodeSchema.safeParse(raw ?? '')
  return parsed.success ? parsed.data : ''
}

export function JoinClient() {
  const router = useRouter()
  const initialRoomCode = sanitiseCode(useSearchParams().get('code'))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<{ code: string; message: string } | undefined>()
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | undefined>()

  const handleSubmit = async (values: { roomCode: string; displayName: string }): Promise<void> => {
    setPending(true)
    setError(undefined)
    setFieldErrors(undefined)
    const result = await joinSession(values.roomCode, values.displayName)
    if (result.ok) {
      router.push(`/session/${result.data.session.roomCode}`)
      return
    }
    setPending(false)
    setFieldErrors(result.fields)
    setError({ code: result.code, message: result.message })
  }

  return (
    <JoinForm
      initialRoomCode={initialRoomCode}
      pending={pending}
      error={error}
      fieldErrors={fieldErrors}
      onSubmit={(values) => void handleSubmit(values)}
    />
  )
}
