'use client'

import { useState, type FormEvent } from 'react'
import { Icon } from '../ui/Icon'
import { button, hintClass, inputClass } from '../ui/styles'

export type AnswerFormProps = {
  questionId: string
  initialAnswer: string | null
  pending: boolean
  error?: string
  onSave: (text: string) => void
  onClear: () => void
}

export const ANSWER_MAX = 500

// Answers are one line: any line break (typed or pasted) is dropped.
export const stripLineBreaks = (value: string): string => value.replace(/[\r\n]+/g, ' ')

export function AnswerForm({ questionId, initialAnswer, pending, error, onSave, onClear }: AnswerFormProps) {
  const [text, setText] = useState(initialAnswer ?? '')
  const inputId = `answer-${questionId}`
  const countId = `${inputId}-count`
  const errorId = `${inputId}-error`

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (text.trim() !== '') onSave(text)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        Answer (one line, shown to everyone)
      </label>
      <input
        id={inputId}
        name="answer"
        type="text"
        maxLength={ANSWER_MAX}
        autoComplete="off"
        disabled={pending}
        value={text}
        onChange={(e) => setText(stripLineBreaks(e.target.value))}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${countId} ${errorId}` : countId}
        className={inputClass}
      />
      <p id={countId} className={hintClass}>
        {text.length}/{ANSWER_MAX} characters
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-sm font-medium text-danger-900">
          Error: {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={pending || text.trim() === ''}
          className={button('primary')}
        >
          <Icon name="check" />
          {pending ? 'Saving…' : 'Save answer'}
        </button>
        <button
          type="button"
          disabled={pending || initialAnswer === null}
          onClick={() => {
            setText('')
            onClear()
          }}
          className={button('secondary')}
        >
          <Icon name="x" />
          Clear answer
        </button>
      </div>
    </form>
  )
}
