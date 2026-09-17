import { describe, expect, test } from 'vitest'
import { workerSettings } from '../../src/persuade/lib/worker-settings'

describe('workerSettings', () => {
  test('defaults when nothing is set', () => {
    expect(workerSettings({})).toEqual({
      dailyCap: 1000,
      batch: 8,
      concurrency: 4,
      lowWater: 50,
      refillChunk: 200,
    })
  })

  test('reads each variable', () => {
    expect(
      workerSettings({
        PERSUADER_DAILY_RUN_CAP: '200',
        PERSUADER_TICK_BATCH: '6',
        PERSUADER_TICK_CONCURRENCY: '2',
        PERSUADER_QUEUE_LOW_WATER: '10',
        PERSUADER_REFILL_CHUNK: '40',
      }),
    ).toEqual({ dailyCap: 200, batch: 6, concurrency: 2, lowWater: 10, refillChunk: 40 })
  })

  test('refuses a value that is not a positive integer rather than guessing', () => {
    expect(() => workerSettings({ PERSUADER_DAILY_RUN_CAP: 'lots' })).toThrow(
      'PERSUADER_DAILY_RUN_CAP',
    )
    expect(() => workerSettings({ PERSUADER_TICK_CONCURRENCY: '0' })).toThrow(
      'PERSUADER_TICK_CONCURRENCY',
    )
    expect(() => workerSettings({ PERSUADER_TICK_BATCH: '2.5' })).toThrow('PERSUADER_TICK_BATCH')
  })
})
