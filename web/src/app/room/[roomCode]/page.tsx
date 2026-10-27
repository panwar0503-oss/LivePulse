'use client'

import { useParams } from 'next/navigation'
import { AppShell } from '../../../components/ui/AppShell'
import { ParticipantClient } from './ParticipantClient'

export default function SessionPage() {
  const params = useParams<{ roomCode: string }>()
  return (
    <AppShell>
      <ParticipantClient roomCode={params.roomCode.toUpperCase()} />
    </AppShell>
  )
}
