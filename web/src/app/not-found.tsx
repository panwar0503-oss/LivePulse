import Link from 'next/link'
import { AppShell } from '../components/ui/AppShell'
import { Icon } from '../components/ui/Icon'
import { routes } from '../lib/routes'
import { linkButton, panelClass } from '../components/ui/styles'

export default function NotFound() {
  return (
    <AppShell>
      <section className={`${panelClass} items-center px-5 py-10 text-center sm:py-14`}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          We could not find that page.
        </h1>
        <p className="max-w-md text-base text-muted">
          The link may be out of date, or the session may have ended.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Link href={routes.home()} className={linkButton('secondary')}>
            <Icon name="home" />
            Go to home
          </Link>
          <Link href={routes.join()} className={linkButton('primary')}>
            <Icon name="users" />
            Join a session
          </Link>
        </div>
      </section>
    </AppShell>
  )
}
