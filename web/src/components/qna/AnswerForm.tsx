'use client'

import { useState, type FormEvent } from 'react'

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

const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-xl min-h-11 px-5 font-medium transition-colors duration-150 motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:opacity-50'

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
        className="min-h-11 w-full rounded-xl border-2 border-slate-500 bg-white px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:bg-slate-50 disabled:text-muted"
      />
      <p id={countId} className="text-sm text-muted">
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
          className={`${buttonClass} bg-brand-600 text-white enabled:hover:bg-brand-700 disabled:bg-slate-400 disabled:opacity-100`}
        >
          {pending ? 'Saving…' : 'Save answer'}
        </button>
        <button
          type="button"
          disabled={pending || initialAnswer === null}
          onClick={() => {
            setText('')
            onClear()
          }}
          className={`${buttonClass} border border-slate-300 bg-white enabled:hover:bg-slate-50`}
        >
          Clear answer
        </button>
      </div>
    </form>
  )
}
