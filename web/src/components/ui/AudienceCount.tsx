import { Icon } from './Icon'

export type AudienceCountProps = {
  count: number | null
  joined?: number
  audience: 'presenter' | 'participant'
}

// Deliberately not a live region: the count changes often and must not be re-announced every tick.
export function AudienceCount({ count, joined, audience }: AudienceCountProps) {
  if (count === null) {
    return (
      <p className="inline-flex items-center gap-1.5 text-sm text-muted">
        <Icon name="users" />
        {audience === 'participant'
          ? 'The number of people here is not shown on this screen.'
          : '— Count unavailable right now'}
      </p>
    )
  }
  return (
    <p className="inline-flex flex-wrap items-center gap-1.5 text-sm text-muted">
      <Icon name="users" />
      <span>{count} people here</span>
      {joined === undefined ? null : <span>({joined} joined)</span>}
    </p>
  )
}
