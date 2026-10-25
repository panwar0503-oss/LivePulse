import { Suspense } from 'react'
import { AppShell } from '../../components/ui/AppShell'
import { pageTitleClass, panelClass } from '../../components/ui/styles'
import { JoinClient } from './JoinClient'

export default function JoinPage() {
  return (
    <AppShell>
      <div className={panelClass}>
        <h1 className={pageTitleClass}>Join a session</h1>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <JoinClient />
        </Suspense>
      </div>
    </AppShell>
  )
}
