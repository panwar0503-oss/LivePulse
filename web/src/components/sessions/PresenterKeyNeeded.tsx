import Link from 'next/link'
import { routes } from '../../lib/routes'
import { ErrorState } from '../ui/ErrorState'
import { button } from '../ui/styles'

export const PRESENTER_KEY_NEEDED_MESSAGE = 'Open the session with its presenter key first.'

// The room page is where the presenter key is asked for and the cookie is set.
export function PresenterKeyNeeded({ sessionId }: { sessionId: string }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <ErrorState message={PRESENTER_KEY_NEEDED_MESSAGE} />
      <Link href={routes.hostRoom(sessionId)} className={button('secondary', 'sm')}>
        Open the session
      </Link>
    </div>
  )
}
