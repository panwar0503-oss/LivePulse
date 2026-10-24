import { describe, expect, it } from 'vitest'
import type { WordCloud } from '@livepulse/shared'
import { liveCloudFor, mergeWordCloud } from './word-cloud-merge'

const cloud = (version: number): WordCloud => ({
  total: version,
  version,
  entries: [{ key: 'a', word: 'a', count: version }],
})

describe('merging a live word cloud into the loaded snapshot', () => {
  it('keeps the snapshot when the live version is not newer', () => {
    expect(mergeWordCloud(cloud(5), cloud(5))).toEqual(cloud(5))
    expect(mergeWordCloud(cloud(5), cloud(3))).toEqual(cloud(5))
  })

  it('takes the live cloud when it is newer', () => {
    expect(mergeWordCloud(cloud(5), cloud(6))).toEqual(cloud(6))
    expect(mergeWordCloud(null, cloud(1))).toEqual(cloud(1))
  })

  it('ignores a cloud for a prompt that is not on screen', () => {
    const live = { 'other-prompt': cloud(9) }
    expect(liveCloudFor('shown-prompt', live)).toBeUndefined()
    expect(liveCloudFor(null, live)).toBeUndefined()
    expect(liveCloudFor('other-prompt', live)).toEqual(cloud(9))
  })
})
