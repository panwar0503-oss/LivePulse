'use client'

import { useState, type FormEvent } from 'react'
import { createSessionBodySchema, type CreateSessionBody } from '@livepulse/shared'
import { Icon } from '../ui/Icon'
import { button } from '../ui/styles'
import { StatusMessage } from './StatusMessage'

export type CreateFormProps = {
  pending: boolean
  error?: string
  // Messages from the server, keyed by field name.
  fieldErrors?: Record<string, string>
  onSubmit: (values: CreateSessionBody) => void
}

const inputClass =
  'w-full rounded-xl border border-slate-500 bg-white px-3 py-2 transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600'

export function CreateForm({ pending, error, fieldErrors, onSubmit }: CreateFormProps) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const errors = { ...fieldErrors, ...clientErrors }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = createSessionBodySchema.safeParse({
      title,
      description: description.trim() === '' ? undefined : description,
    })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'title')
        next[key] ??= issue.message
      }
      setClientErrors(next)
      return
    }
    setClientErrors({})
    onSubmit(parsed.data)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 text-left">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Host a session</h1>
        <p className="text-muted">
          Give your session a name and we will set up a room your audience can join.
        </p>
      </div>
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="font-medium">
          Session title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          required
          maxLength={80}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? 'title-error' : undefined}
          className={inputClass}
        />
        {errors.title ? (
          <p id="title-error" className="text-sm text-danger-800">
            {errors.title}
          </p>
        ) : null}
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="description" className="font-medium">
          Description (optional)
        </label>
        <textarea
          id="description"
          name="description"
          rows={3}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={errors.description ? 'description-error' : undefined}
          className={inputClass}
        />
        {errors.description ? (
          <p id="description-error" className="text-sm text-danger-800">
            {errors.description}
          </p>
        ) : null}
      </div>
      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className={`${button('primary')} self-start`}
      >
        <Icon name="plus" />
        {pending ? 'Creating…' : 'Host a session'}
      </button>
    </form>
  )
}
