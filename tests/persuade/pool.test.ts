/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { runPool } from '../../src/persuade/lib/pool'

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('runPool', () => {
  test('never runs more than the concurrency at once', async () => {
    let active = 0
    let peak = 0
    await runPool([1, 2, 3, 4, 5, 6, 7, 8], 4, async () => {
      active += 1
      peak = Math.max(peak, active)
      await pause(5)
      active -= 1
    })
    expect(peak).toBe(4)
  })

  test('returns results in input order, whatever order they finish in', async () => {
    const results = await runPool([30, 10, 20], 3, async (ms) => {
      await pause(ms)
      return ms
    })
    expect(results).toEqual([30, 10, 20])
  })

  test('handles an empty batch and a concurrency larger than the batch', async () => {
    expect(await runPool([], 4, async () => 1)).toEqual([])
    expect(await runPool([1], 10, async (n) => n * 2)).toEqual([2])
  })
})
