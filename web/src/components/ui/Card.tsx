import { useId, type ReactNode } from 'react'

export type CardProps = {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  // Feature panels bring their own heading, so the card title is optional and h2 by default.
  headingLevel?: 2 | 3
  className?: string
  children?: ReactNode
}

export function Card({ title, description, actions, headingLevel = 2, className = '', children }: CardProps) {
  const headingId = useId()
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const hasHeader = title !== undefined || actions !== undefined
  return (
    <section
      aria-labelledby={title === undefined ? undefined : headingId}
      className={`flex flex-col gap-4 min-w-0 rounded-2xl border border-line bg-surface p-5 text-left sm:p-6 ${className}`}
    >
      {hasHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            {title === undefined ? null : (
              <Heading id={headingId} className="text-lg font-semibold tracking-tight text-ink">
                {title}
              </Heading>
            )}
            {description ? <p className="text-sm text-muted">{description}</p> : null}
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  )
}
