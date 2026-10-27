'use client'

import { useState, type FormEvent } from 'react'
import { KNOWLEDGE_LIMITS } from '@livepulse/shared'
import { Icon } from '../ui/Icon'
import { button, hintClass, inputClass, labelClass } from '../ui/styles'

export type KnowledgeSearchProps = {
  pending: boolean
  onSearch: (query: string) => void
}

export function KnowledgeSearch({ pending, onSearch }: KnowledgeSearchProps) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (trimmed) onSearch(trimmed)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2">
      <label htmlFor="knowledge-query" className={labelClass}>
        Search your files
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id="knowledge-query"
          type="search"
          value={query}
          maxLength={KNOWLEDGE_LIMITS.searchQueryMaxChars}
          onChange={(e) => setQuery(e.target.value)}
          aria-describedby="knowledge-query-hint"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <button type="submit" disabled={pending || !trimmed} className={button('primary')}>
          <Icon name="search" />
          Search
        </button>
      </div>
      <p id="knowledge-query-hint" className={hintClass}>
        1 to {KNOWLEDGE_LIMITS.searchQueryMaxChars} characters.
      </p>
    </form>
  )
}
