import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import NotFound from './not-found'

describe('not found page', () => {
  const html = renderToStaticMarkup(<NotFound />)

  it('says the page could not be found', () => {
    expect(html).toMatch(/<h1[^>]*>.*We could not find that page\.<\/h1>/)
  })

  it('links to home and to join a session', () => {
    expect(html).toMatch(/<a[^>]*href="\/"[^>]*>.*Go to home<\/a>/)
    expect(html).toMatch(/<a[^>]*href="\/join"[^>]*>.*Join a session<\/a>/)
  })
})
