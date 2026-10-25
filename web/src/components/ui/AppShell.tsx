import Link from 'next/link'
import type { ReactNode } from 'react'
import { focusRing } from './styles'

export type AppShellProps = {
  // Page title shown next to the brand; pass the page's h1 when it belongs in the header.
  title?: ReactNode
  // Status, chips and actions on the right of the header.
  right?: ReactNode
  // wide: presenter dashboard; narrow: participant and forms.
  width?: 'wide' | 'narrow'
  children: ReactNode
}

const WIDTHS = { wide: 'max-w-6xl', narrow: 'max-w-2xl' } as const

export function AppShell({ title, right, width = 'narrow', children }: AppShellProps) {
  const container = `mx-auto w-full ${WIDTHS[width]} px-4 sm:px-6`
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-line bg-surface">
        <div className={`${container} flex flex-wrap items-center gap-x-4 gap-y-2 py-3`}>
          <Link
            href="/"
            className={`inline-flex items-center gap-2 rounded-lg text-base font-semibold tracking-tight text-ink ${focusRing}`}
          >
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-brand-600" />
            LivePulse
          </Link>
          {title ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 border-l border-line pl-4">{title}</div>
          ) : (
            <div className="flex-1" />
          )}
          {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
        </div>
      </header>
      <main className={`${container} flex min-w-0 flex-1 flex-col gap-6 py-6 sm:gap-8 sm:py-8`}>
        {children}
      </main>
    </div>
  )
}
