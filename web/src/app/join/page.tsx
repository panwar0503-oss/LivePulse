import { Suspense } from 'react'
import { JoinClient } from './JoinClient'

export default function JoinPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold">Join a session</h1>
      <Suspense fallback={<p role="status">Loading…</p>}>
        <JoinClient />
      </Suspense>
    </main>
  )
}
