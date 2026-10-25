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
          className="w-full rounded-xl border border-slate-500 bg-white px-3 py-2 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-4 py-2 font-medium text-white transition-colors duration-150 enabled:hover:bg-brand-700 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-400"
      >
        {pending ? 'Checking…' : 'Open dashboard'}
      </button>
    </form>
  )
}
