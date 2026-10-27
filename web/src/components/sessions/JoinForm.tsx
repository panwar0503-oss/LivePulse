'use client'

import { useState, type FormEvent } from 'react'
import { displayNameSchema, roomCodeSchema } from '@livepulse/shared'
import { StatusMessage } from './StatusMessage'
import { Icon } from '../ui/Icon'
import { button, inputClass, labelClass, pageTitleClass } from '../ui/styles'

export type JoinFormProps = {
  initialRoomCode: string
  pending: boolean
  // Error code from the API client (e.g. SESSION_NOT_OPEN, RATE_LIMITED, NETWORK_ERROR) and its plain message.
  error?: { code: string; message: string }
  fieldErrors?: Record<string, string>
  onSubmit: (values: { roomCode: string; displayName: string }) => void
}

export const joinErrorText = (error: { code: string; message: string }): string => {
  switch (error.code) {
    case 'SESSION_NOT_OPEN':
      return 'This session is not open for joining. Check the code with the presenter.'
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'NETWORK_ERROR':
      return error.message
    default:
      return error.message || 'Something went wrong. Please try again.'
  }
}

export function JoinForm({ initialRoomCode, pending, error, fieldErrors, onSubmit }: JoinFormProps) {
  const [roomCode, setRoomCode] = useState(initialRoomCode)
  const [displayName, setDisplayName] = useState('')
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const errors = { ...fieldErrors, ...clientErrors }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const code = roomCodeSchema.safeParse(roomCode)
    const name = displayNameSchema.safeParse(displayName)
    if (!code.success || !name.success) {
      setClientErrors({
        ...(code.success
          ? {}
          : { roomCode: code.error.issues[0]?.message ?? 'Room code must be 6 letters or digits.' }),
        ...(name.success
          ? {}
          : { displayName: name.error.issues[0]?.message ?? 'Display name must be 1–30 characters.' }),
      })
      return
    }
    setClientErrors({})
    onSubmit({ roomCode: code.data, displayName: name.data })
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 text-left">
      <div className="flex flex-col gap-2">
        <h1 className={pageTitleClass}>Join a session</h1>
        <p className="text-muted">Enter the code shown on the screen, or open the link.</p>
      </div>
      {error ? <StatusMessage kind="error">{joinErrorText(error)}</StatusMessage> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="roomCode" className={labelClass}>
          Room code
        </label>
        <input
          id="roomCode"
          name="roomCode"
          type="text"
          required
          maxLength={6}
          autoComplete="off"
          autoCapitalize="characters"
          value={roomCode}
          onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
          aria-invalid={errors.roomCode ? true : undefined}
          aria-describedby={errors.roomCode ? 'roomCode-error' : undefined}
          className={`${inputClass} uppercase tracking-widest`}
        />
        {errors.roomCode ? (
          <p id="roomCode-error" className="text-sm font-medium text-danger-800">
            {errors.roomCode}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="displayName" className={labelClass}>
          Your name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          required
          maxLength={30}
          autoComplete="nickname"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          aria-invalid={errors.displayName ? true : undefined}
          aria-describedby={errors.displayName ? 'displayName-error' : undefined}
          className={inputClass}
        />
        {errors.displayName ? (
          <p id="displayName-error" className="text-sm font-medium text-danger-800">
            {errors.displayName}
          </p>
        ) : null}
      </div>
      <button type="submit" disabled={pending} className={button('primary')}>
        <Icon name="users" />
        {pending ? 'Joining…' : 'Join a session'}
      </button>
    </form>
  )
}
