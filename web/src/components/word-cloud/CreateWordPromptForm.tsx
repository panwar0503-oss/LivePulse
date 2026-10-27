'use client'

import { useState, type FormEvent } from 'react'
import { createWordPromptBodySchema, type CreateWordPromptBody } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { Icon } from '../ui/Icon'
import { button, checkboxClass, inputClass } from '../ui/styles'

export type CreateWordPromptFormProps = {
  pending: boolean
  error?: string
  fieldErrors?: Record<string, string>
  onSubmit: (values: CreateWordPromptBody) => void
}

const QUESTION_MAX = 200

export function CreateWordPromptForm({ pending, error, fieldErrors, onSubmit }: CreateWordPromptFormProps) {
  const [question, setQuestion] = useState('')
  const [showCloud, setShowCloud] = useState(true)
  const [clientError, setClientError] = useState<string | undefined>()
  const questionError = clientError ?? fieldErrors?.question

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = createWordPromptBodySchema.safeParse({ question, showCloud })
    if (!parsed.success) {
      setClientError(parsed.error.issues[0]?.message ?? 'Check the question and try again.')
      return
    }
    setClientError(undefined)
    onSubmit(parsed.data)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 text-left">
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="word-question" className="font-medium">
          Question
        </label>
        <input
          id="word-question"
          name="question"
          type="text"
          required
          maxLength={QUESTION_MAX}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-invalid={questionError ? true : undefined}
          aria-describedby={questionError ? 'word-question-count word-question-error' : 'word-question-count'}
          className={inputClass}
        />
        <p id="word-question-count" className="text-sm text-muted">
          {question.length}/{QUESTION_MAX} characters
        </p>
        {questionError ? (
          <p id="word-question-error" className="text-sm text-danger-800">
            {questionError}
          </p>
        ) : null}
      </div>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={showCloud}
          onChange={(e) => setShowCloud(e.target.checked)}
          className={checkboxClass}
        />
        Show cloud to participants
      </label>

      <button
        type="submit"
        disabled={pending}
        className={button('primary')}
      >
        <Icon name="plus" />
        {pending ? 'Creating…' : 'Create word cloud'}
      </button>
    </form>
  )
}
