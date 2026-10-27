import { describe, expect, it } from 'vitest'
import { runningMeanCentroid } from './nodes.js'

describe('question clusters', () => {
  it('the cluster centroid is the running mean of its questions', () => {
    const questions = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 4],
    ]
    let centroid = questions[0] ?? []
    for (const [index, vector] of questions.slice(1).entries()) {
      centroid = runningMeanCentroid(centroid, index + 1, vector)
    }
    expect(centroid.map((v) => Number(v.toFixed(6)))).toEqual([0.333333, 0.333333, 1.333333])
    expect(() => runningMeanCentroid([1, 2], 1, [1])).toThrow()
  })
})
