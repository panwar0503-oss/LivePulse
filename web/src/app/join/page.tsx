import { Suspense } from 'react'
import { AppShell } from '../../components/ui/AppShell'
import { panelClass } from '../../components/ui/styles'
import { JoinClient } from './JoinClient'

export default function JoinPage() {
  return (
    <AppShell>
      <div className={panelClass}>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <JoinClient />
        </Suspense>
      </div>
    </AppShell>
  )
}
