import { describe, expect, it } from 'vitest'
import { connectionView } from './connection-view'

describe('connectionView', () => {
  it('says Live when connected', () => {
    expect(connectionView({ status: 'connected', ended: false })).toEqual({
      tone: 'live',
      label: 'Live',
      sentence: 'You are connected. Updates appear as they happen.',
    })
  })

  it('says Connecting with the reconnecting look while first connecting', () => {
    expect(connectionView({ status: 'connecting', ended: false })).toEqual({
      tone: 'reconnecting',
      label: 'Connecting',
      sentence: 'Connecting to the session…',
    })
  })

  it('reassures that nothing sent is lost while reconnecting', () => {
    const view = connectionView({ status: 'reconnecting', ended: false })
    expect(view.tone).toBe('reconnecting')
    expect(view.label).toBe('Reconnecting')
    expect(view.sentence).toBe(
      'Connection lost. Trying again — nothing you sent is lost, and the page will refresh when it is back.',
    )
  })

  it.each(['disconnected', 'refused'] as const)('tells the user to refresh when %s', (status) => {
    expect(connectionView({ status, ended: false })).toEqual({
      tone: 'disconnected',
      label: 'Disconnected',
      sentence: 'Live updates stopped. Refresh the page.',
    })
  })

  it.each(['connecting', 'connected', 'reconnecting', 'disconnected', 'refused'] as const)(
    'shows Ended first even when %s',
    (status) => {
      expect(connectionView({ status, ended: true })).toEqual({
        tone: 'ended',
        label: 'Ended',
        sentence: 'This session has ended.',
      })
    },
  )

  it('adds a delay note when updates are degraded', () => {
    const view = connectionView({ status: 'connected', ended: false, degraded: true })
    expect(view.sentence).toBe(
      'You are connected. Updates appear as they happen. Live updates may be delayed.',
    )
    expect(view.tone).toBe('live')
  })
})
