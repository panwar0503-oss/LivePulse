import Link from 'next/link'
import { AppShell } from '../components/ui/AppShell'
import { linkButton, panelClass } from '../components/ui/styles'

const FEATURES = [
  { name: 'Polls', text: 'Ask a question and watch votes arrive.' },
  { name: 'Word cloud', text: 'Collect one-word answers as themes.' },
  { name: 'Q&A', text: 'Let the audience ask and upvote.' },
] as const

export default function Page() {
  return (
    <AppShell>
      <section className={`${panelClass} items-center px-5 py-10 text-center sm:py-14`}>
        <p className="rounded-full bg-brand-50 px-3 py-1 text-sm font-medium text-brand-800">
          Live audience engagement
        </p>
        <h1 className="text-4xl font-semibold tracking-tight text-ink sm:text-5xl">LivePulse</h1>
        <p className="max-w-md text-base text-muted sm:text-lg">
          Run polls, word clouds and Q&amp;A with your audience in real time.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href="/create" className={linkButton('primary')}>
            Create a session
          </Link>
          <Link href="/join" className={linkButton('secondary')}>
            Join a session
          </Link>
        </div>
      </section>
      <ul className="grid gap-4 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <li key={feature.name} className="min-w-0 rounded-2xl border border-line bg-surface p-5 text-left">
            <h2 className="text-base font-semibold tracking-tight text-ink">{feature.name}</h2>
            <p className="mt-1 text-[15px] text-muted">{feature.text}</p>
          </li>
        ))}
      </ul>
    </AppShell>
  )
}
