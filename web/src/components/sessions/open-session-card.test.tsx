import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))

import { OpenSessionCard } from './OpenSessionCard'

describe('open my session card', () => {
  const html = renderToStaticMarkup(<OpenSessionCard />)

  it('has a recent sessions heading', () => {
    expect(html).toContain('Your recent sessions')
  })

  it('lets a host paste a link or session id and open it', () => {
    expect(html).toContain('Host link or session ID')
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>.*Open my session<\/button>/)
  })

  it('waits for the browser before showing the saved list', () => {
    expect(html).not.toContain('will appear here')
  })
})
