'use client'

import { useState, type FormEvent } from 'react'
import { StatusMessage } from './StatusMessage'

export type PresenterKeyFormProps = {
  pending: boolean
  error?: { code: string; message: string }
  onSubmit: (presenterKey: string) => void
}

export const presenterKeyErrorText = (error: { code: string; message: string }): string => {
  switch (error.code) {
    case 'RATE_LIMITED':
      return 'Too many attempts. Please wait a moment and try again.'
    case 'NETWORK_ERROR':
      return error.message
    case 'INVALID_PRESENTER_KEY':
    case 'UNAUTHORIZED':
    case 'VALIDATION_ERROR':
      return 'That presenter key is not valid.'
    default:
      return error.message || 'Something went wrong. Please try again.'
  }
}

export function PresenterKeyForm({ pending, error, onSubmit }: PresenterKeyFormProps) {
  const [presenterKey, setPresenterKey] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSubmit(presenterKey.trim())
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 text-left">
      <p>Enter the presenter key you were given when you created this session.</p>
      {error ? <StatusMessage kind="error">{presenterKeyErrorText(error)}</StatusMessage> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="presenterKey" className="font-medium">
          Presenter key
        </label>
        <input
          id="presenterKey"
          name="presenterKey"
          type="password"
          required
          autoComplete="off"
          spellCheck={false}
          value={presenterKey}
          onChange={(e) => setPresenterKey(e.target.value)}
          className="w-full rounded border border-slate-500 p-2 focus:outline focus:outline-2 focus:outline-blue-700"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-700 px-4 py-2 font-medium text-white focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-blue-700 disabled:bg-slate-400"
      >
        {pending ? 'Checking…' : 'Open dashboard'}
      </button>
    </form>
  )
}
