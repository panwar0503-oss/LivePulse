'use client'

import { useParams } from 'next/navigation'
import { ParticipantClient } from './ParticipantClient'

export default function SessionPage() {
  const params = useParams<{ roomCode: string }>()
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <ParticipantClient roomCode={params.roomCode.toUpperCase()} />
    </main>
  )
}
