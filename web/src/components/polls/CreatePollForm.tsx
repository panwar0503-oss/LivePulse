'use client'

import { useState, type FormEvent } from 'react'
import { createPollBodySchema, type CreatePollBody } from '@livepulse/shared'
import { StatusMessage } from '../sessions/StatusMessage'
import { Icon } from '../ui/Icon'
import { button, checkboxClass, inputClass } from '../ui/styles'

export type CreatePollFormProps = {
  pending: boolean
  error?: string
  // Messages from the server, keyed by field name.
  fieldErrors?: Record<string, string>
  onSubmit: (values: CreatePollBody) => void
  // Prefill, e.g. from an AI suggestion. Read once on mount: the parent changes `key` to apply a new one.
  initialValues?: { question: string; options: string[] }
}

const MIN_OPTIONS = 2
const MAX_OPTIONS = 6
const QUESTION_MAX = 200

export function CreatePollForm({
  pending,
  error,
  fieldErrors,
  onSubmit,
  initialValues,
}: CreatePollFormProps) {
  const [question, setQuestion] = useState(initialValues?.question ?? '')
  const [options, setOptions] = useState<string[]>(initialValues?.options ?? ['', ''])
  const [showResults, setShowResults] = useState(true)
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({})
  const errors = { ...fieldErrors, ...clientErrors }

  const setOption = (index: number, value: string): void =>
    setOptions((current) => current.map((o, i) => (i === index ? value : o)))

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const parsed = createPollBodySchema.safeParse({ question, options, showResults })
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? 'question')
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
      {error ? <StatusMessage kind="error">{error}</StatusMessage> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor="poll-question" className="font-medium">
          Question
        </label>
        <input
          id="poll-question"
          name="question"
          type="text"
          required
          maxLength={QUESTION_MAX}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-invalid={errors.question ? true : undefined}
          aria-describedby={
            errors.question ? 'poll-question-count poll-question-error' : 'poll-question-count'
          }
          className={inputClass}
        />
        <p id="poll-question-count" className="text-sm text-muted">
          {question.length}/{QUESTION_MAX} characters
        </p>
        {errors.question ? (
          <p id="poll-question-error" className="text-sm text-danger-800">
            {errors.question}
          </p>
        ) : null}
      </div>

      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={errors.options ? 'poll-options-error' : undefined}
      >
        <legend className="font-medium">
          Options ({MIN_OPTIONS} to {MAX_OPTIONS})
        </legend>
        {options.map((value, index) => (
          <div key={index} className="flex items-center gap-2">
            <label htmlFor={`poll-option-${index}`} className="sr-only">
              Option {index + 1}
            </label>
            <input
              id={`poll-option-${index}`}
              type="text"
              maxLength={80}
              value={value}
              onChange={(e) => setOption(index, e.target.value)}
              className={inputClass}
            />
            <button
              type="button"
              disabled={options.length <= MIN_OPTIONS}
              onClick={() => setOptions((current) => current.filter((_, i) => i !== index))}
              className={`${button('secondary', 'sm')} shrink-0`}
            >
              <Icon name="trash" />
              Remove<span className="sr-only"> option {index + 1}</span>
            </button>
          </div>
        ))}
        {errors.options ? (
          <p id="poll-options-error" className="text-sm text-danger-800">
            {errors.options}
          </p>
        ) : null}
        <div>
          <button
            type="button"
            disabled={options.length >= MAX_OPTIONS}
            onClick={() => setOptions((current) => [...current, ''])}
            className={button('secondary')}
          >
            <Icon name="plus" />
            Add option
          </button>
        </div>
      </fieldset>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={showResults}
          onChange={(e) => setShowResults(e.target.checked)}
          className={checkboxClass}
        />
        Show results to participants
      </label>

      <button
        type="submit"
        disabled={pending}
        className={button('primary')}
      >
        <Icon name="plus" />
        {pending ? 'Creating…' : 'Create poll'}
      </button>
    </form>
  )
}
