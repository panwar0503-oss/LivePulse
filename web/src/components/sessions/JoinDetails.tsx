import Link from 'next/link'
import { routes } from '../../lib/routes'
import { CopyButton } from '../ui/CopyButton'
import { Icon } from '../ui/Icon'
import { linkButton, panelClass, sectionTitleClass } from '../ui/styles'

export type JoinDetailsProps = {
  roomCode: string
  joinUrl: string
  showAudienceLink?: boolean
}

export function JoinDetails({ roomCode, joinUrl, showAudienceLink = false }: JoinDetailsProps) {
  return (
    <section aria-labelledby="join-details-title" className={panelClass}>
      <h2 id="join-details-title" className={sectionTitleClass}>
        Join this room
      </h2>
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Room code</span>
          <span className="font-mono text-2xl font-semibold tracking-widest break-all">{roomCode}</span>
          <CopyButton value={roomCode}>Copy code</CopyButton>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-sm text-muted">Join link</span>
          <span className="break-all text-ink">{joinUrl}</span>
          <CopyButton value={joinUrl}>Copy link</CopyButton>
        </div>
        {showAudienceLink ? (
          <Link href={routes.room(roomCode)} className={`${linkButton('secondary')} w-fit`}>
            <Icon name="external" />
            Open audience view
          </Link>
        ) : null}
      </div>
    </section>
  )
}
