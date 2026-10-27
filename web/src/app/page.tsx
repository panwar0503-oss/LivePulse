import Link from 'next/link'
import { AppShell } from '../components/ui/AppShell'
import { Card } from '../components/ui/Card'
import { Icon, type IconName } from '../components/ui/Icon'
import { OpenSessionCard } from '../components/sessions/OpenSessionCard'
import { routes } from '../lib/routes'
import { linkButton, panelClass } from '../components/ui/styles'

const FEATURES: ReadonlyArray<{ name: string; text: string; icon: IconName }> = [
  { name: 'Polls', text: 'Ask a question and watch votes arrive.', icon: 'chart' },
  { name: 'Questions', text: 'Let the audience ask and upvote.', icon: 'users' },
  { name: 'Word cloud', text: 'Collect one-word answers as themes.', icon: 'sparkles' },
]

export default function Page() {
  return (
    <AppShell>
      <section className={`${panelClass} items-center px-5 py-10 text-center sm:py-14`}>
        <p className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">
          Live audience engagement
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">LivePulse</h1>
        <p className="max-w-md text-sm text-muted sm:text-base">
          Hosts run polls, questions and word clouds; the audience joins with a room code and takes part in
          real time.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href={routes.host()} className={linkButton('primary')}>
            <Icon name="plus" />
            Host a session
          </Link>
          <Link href={routes.join()} className={linkButton('secondary')}>
            <Icon name="users" />
            Join a session
          </Link>
        </div>
      </section>
      <ul className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.name} className="min-w-0">
            <Card
              title={
                <span className="inline-flex items-center gap-2">
                  <Icon name={feature.icon} className="text-lg text-brand-700" />
                  {feature.name}
                </span>
              }
              className="h-full"
            >
              <p className="text-sm text-muted">{feature.text}</p>
            </Card>
          </li>
        ))}
      </ul>
      <OpenSessionCard />
    </AppShell>
  )
}
