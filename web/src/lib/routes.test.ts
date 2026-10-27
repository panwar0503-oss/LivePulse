import { describe, expect, it } from 'vitest'
import { routes } from './routes'

describe('routes', () => {
  it('builds the presenter room under /host with its knowledge and report pages', () => {
    expect(routes.host()).toBe('/host')
    expect(routes.hostRoom('abc-123')).toBe('/host/abc-123')
    expect(routes.hostKnowledge('abc-123')).toBe('/host/abc-123/knowledge')
    expect(routes.hostReport('abc-123')).toBe('/host/abc-123/report')
  })

  it('builds the join page with the room code only when one is given', () => {
    expect(routes.join()).toBe('/join')
    expect(routes.join('ABC234')).toBe('/join?code=ABC234')
  })

  it('builds the audience room under /room', () => {
    expect(routes.room('ABC234')).toBe('/room/ABC234')
  })

  it('encodes ids so they cannot add path segments', () => {
    expect(routes.room('a/b')).toBe('/room/a%2Fb')
    expect(routes.hostRoom('x?y')).toBe('/host/x%3Fy')
  })
})
