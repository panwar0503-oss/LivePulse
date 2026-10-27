'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { KNOWLEDGE_LIMITS } from '@livepulse/shared'
import { knowledgeMimeType } from '../../lib/api/knowledge-client'
import { StatusMessage } from '../sessions/StatusMessage'
import { Icon } from '../ui/Icon'
import { focusRing, hintClass, labelClass } from '../ui/styles'

export const UNSUPPORTED_FILE_MESSAGE = 'Only PDF (.pdf) and plain text (.txt) files can be added.'
export const TOO_LARGE_FILE_MESSAGE = 'That file is larger than 10 MB.'
export const EMPTY_FILE_MESSAGE = 'That file is empty.'

type FileLike = { name: string; type: string; size: number }

// Returns a plain refusal message, or null when the file may be sent. UX only; the server checks again.
export const validateUploadFile = (file: FileLike): string | null => {
  if (knowledgeMimeType(file) === null) return UNSUPPORTED_FILE_MESSAGE
  if (file.size === 0) return EMPTY_FILE_MESSAGE
  if (file.size > KNOWLEDGE_LIMITS.maxFileBytes) return TOO_LARGE_FILE_MESSAGE
  return null
}

export type KnowledgeUploadProps = {
  disabled: boolean
  onUpload: (file: File) => void
}

export function KnowledgeUpload({ disabled, onUpload }: KnowledgeUploadProps) {
  const [refusal, setRefusal] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    if (!file) return
    const problem = validateUploadFile(file)
    setRefusal(problem)
    if (!problem) onUpload(file)
    if (inputRef.current) inputRef.current.value = '' // allow choosing the same file again
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="knowledge-file" className={`${labelClass} inline-flex items-center gap-2`}>
        <Icon name="upload" />
        Add a file
      </label>
      <input
        ref={inputRef}
        id="knowledge-file"
        type="file"
        accept=".pdf,.txt,application/pdf,text/plain"
        disabled={disabled}
        onChange={handleChange}
        aria-describedby="knowledge-file-hint"
        className={`block w-full text-sm text-ink file:mr-3 file:min-h-9 file:rounded-xl file:border file:border-slate-300 file:bg-white file:px-3 file:text-ink ${focusRing}`}
      />
      <p id="knowledge-file-hint" className={hintClass}>
        PDF or plain text (.txt). Files are {KNOWLEDGE_LIMITS.maxFileBytes / 1024 / 1024} MB at most, and{' '}
        {KNOWLEDGE_LIMITS.maxFilesPerSession} files per session.
      </p>
      {refusal ? <StatusMessage kind="error">{refusal}</StatusMessage> : null}
    </div>
  )
}
