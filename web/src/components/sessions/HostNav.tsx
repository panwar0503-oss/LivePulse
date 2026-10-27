import Link from 'next/link'
import { routes } from '../../lib/routes'
import { Icon, type IconName } from '../ui/Icon'
import { focusRing } from '../ui/styles'

export type HostNavProps = {
  sessionId: string
  current: 'room' | 'knowledge' | 'report'
}

const ITEMS: { key: HostNavProps['current']; label: string; icon: IconName; href: (id: string) => string }[] =
  [
    { key: 'room', label: 'Room', icon: 'radio', href: routes.hostRoom },
    { key: 'knowledge', label: 'Knowledge', icon: 'file', href: routes.hostKnowledge },
    { key: 'report', label: 'Report', icon: 'chart', href: routes.hostReport },
  ]

export function HostNav({ sessionId, current }: HostNavProps) {
  return (
    <nav aria-label="Session sections" className="flex flex-wrap gap-2">
      {ITEMS.map((item) => {
        const active = item.key === current
        return (
          <Link
            key={item.key}
            href={item.href(sessionId)}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-sm ${focusRing} ${
              active ? 'bg-brand-600 font-semibold text-white' : 'font-medium text-ink hover:bg-slate-100'
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
