/**
 * The worker's knobs, read once per tick.
 *
 * A value that is set but unreadable throws instead of falling back to the
 * default. The default cap is 1,000; a typo in PERSUADER_DAILY_RUN_CAP that
 * silently meant 1,000 would be the most expensive kind of typo.
 */

export interface WorkerSettings {
  dailyCap: number
  batch: number
  concurrency: number
  lowWater: number
  refillChunk: number
}

const DEFAULTS: Record<string, number> = {
  PERSUADER_DAILY_RUN_CAP: 1000,
  PERSUADER_TICK_BATCH: 8,
  PERSUADER_TICK_CONCURRENCY: 4,
  PERSUADER_QUEUE_LOW_WATER: 50,
  PERSUADER_REFILL_CHUNK: 200,
}

function positiveInt(env: Record<string, string | undefined>, name: string): number {
  const raw = env[name]
  if (raw === undefined || raw.trim() === '') return DEFAULTS[name] as number
  const value = Number(raw)
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} חייב להיות מספר שלם חיובי, התקבל "${raw}"`)
  }
  return value
}

export function workerSettings(
  env: Record<string, string | undefined> = process.env,
): WorkerSettings {
  return {
    dailyCap: positiveInt(env, 'PERSUADER_DAILY_RUN_CAP'),
    batch: positiveInt(env, 'PERSUADER_TICK_BATCH'),
    concurrency: positiveInt(env, 'PERSUADER_TICK_CONCURRENCY'),
    lowWater: positiveInt(env, 'PERSUADER_QUEUE_LOW_WATER'),
    refillChunk: positiveInt(env, 'PERSUADER_REFILL_CHUNK'),
  }
}
