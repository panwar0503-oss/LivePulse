---
name: frontend-patterns
description: LivePulse Next.js App Router + React + Tailwind patterns - pages, client components, data hooks, forms, UI states, styling, component reuse. Use when writing web/ code.
---

# Frontend patterns (Next.js App Router + React + Tailwind)

Match installed versions; read a sibling file first. Reuse before creating.

## Structure (proposed)
```
web/src/app/                     routes: (host)/sessions/[id]/page.tsx, join/[code]/page.tsx
web/src/components/ui/           reusable primitives: Button, Input, Card, Spinner, ErrorState, EmptyState
web/src/components/<feature>/    feature components: PollCard, PollResults, QuestionList
web/src/hooks/                   data hooks: usePoll, useCreatePoll
web/src/lib/api/                 fetch client + endpoint functions typed with shared schemas
web/src/realtime/                socket provider + typed event hooks (see realtime-patterns)
```

## Component reuse (check before writing UI)
1. Glob `web/src/components/ui/*` — use an existing primitive or add a **variant** to it.
2. No raw `<button>`/`<input>` with one-off styling inside feature components.
3. A pattern repeated twice → extract to `components/ui/`.

## Server vs client
Server components by default (initial data fetch, no secrets in client). `"use client"` only for interactivity,
sockets, or browser APIs. Pass serialisable props across the boundary.

## API client
```ts
export async function apiFetch<T>(path: string, schema: ZodType<T>, init?: RequestInit): Promise<T> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, { ...init, credentials: 'include', headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) throw ApiError.from(res.status, body)
  return schema.parse(body)
}
```

## Data hook + UI states
```tsx
export function PollPanel({ pollId }: { pollId: string }) {
  const { data, error, isLoading, retry } = usePoll(pollId)
  if (isLoading) return <Spinner label="Loading poll" />
  if (error) return <ErrorState message={error.message} onRetry={retry} />
  if (!data) return <EmptyState title="Poll not found" />
  return <PollCard poll={data} />
}
```
(Data-fetching library — plain hooks vs TanStack Query — is a Phase 2 decision; ask before adding one.)

## Forms
Validate with the shared Zod schema client-side for UX; the server re-validates. Disable submit while pending;
show field errors with `aria-describedby`; map API error codes to friendly messages.

## Styling
Tailwind utilities with design tokens in the Tailwind config (colours, spacing) — no hardcoded hex values or
arbitrary values in components. Merge classes with a `cn()` helper if one exists. Mobile-first; WCAG AA contrast.
