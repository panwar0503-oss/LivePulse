'use client'

import { useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { focusRing, motionIn } from './styles'

export type TabItem = { id: string; label: string; count?: number; icon?: IconName }

export type TabsProps = {
  tabs: TabItem[]
  // Accessible name for the tab list.
  label: string
  // Prefix keeping tab and panel ids unique on the page.
  idPrefix: string
  // Called once per tab. Inactive panels stay mounted but hidden, so live subscriptions
  // and half-typed drafts survive switching tabs.
  children: (id: string) => ReactNode
}

export function Tabs({ tabs, label, idPrefix, children }: TabsProps) {
  const [activeId, setActiveId] = useState(tabs[0]?.id ?? '')
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const select = (index: number): void => {
    const next = tabs[(index + tabs.length) % tabs.length]
    if (!next) return
    setActiveId(next.id)
    refs.current[next.id]?.focus()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowRight') select(index + 1)
    else if (event.key === 'ArrowLeft') select(index - 1)
    else if (event.key === 'Home') select(0)
    else if (event.key === 'End') select(tabs.length - 1)
    else return
    event.preventDefault()
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={label}
        className="flex flex-wrap gap-1 rounded-2xl border border-line bg-surface p-1"
      >
        {tabs.map((tab, index) => {
          const selected = tab.id === activeId
          return (
            <button
              key={tab.id}
              ref={(el) => {
                refs.current[tab.id] = el
              }}
              id={`${idPrefix}-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`inline-flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-colors duration-150 motion-reduce:transition-none sm:flex-none ${focusRing} ${
                selected ? 'bg-brand-600 text-white' : 'text-slate-700 hover:bg-slate-100 hover:text-ink'
              }`}
            >
              {tab.icon ? <Icon name={tab.icon} /> : null}
              {tab.label}
              {tab.count === undefined ? null : (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          id={`${idPrefix}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${idPrefix}-tab-${tab.id}`}
          tabIndex={0}
          hidden={tab.id !== activeId}
          className={`rounded-2xl ${focusRing} ${motionIn}`}
        >
          {children(tab.id)}
        </div>
      ))}
    </div>
  )
}
