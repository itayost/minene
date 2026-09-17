/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import {
  type BreakerOutcome,
  breakerVerdict,
  DEFAULT_BREAKER,
  readRecentOutcomes,
} from '../../src/persuade/lib/breaker'

const NOW = new Date('2026-09-17T12:00:00.000Z')

const outcomesOf = (
  failed: number,
  done: number,
  updatedAt: string = NOW.toISOString(),
): BreakerOutcome[] => [
  ...Array.from({ length: failed }, () => ({ status: 'failed', updatedAt })),
  ...Array.from({ length: done }, () => ({ status: 'done', updatedAt })),
]

describe('breakerVerdict', () => {
  test('trips when more than 80% of at least 20 recent outcomes failed', () => {
    expect(breakerVerdict(outcomesOf(17, 3), DEFAULT_BREAKER, NOW)).toEqual({
      open: true,
      failed: 17,
      total: 20,
    })
  })

  test('does not trip at exactly 80%', () => {
    expect(breakerVerdict(outcomesOf(16, 4), DEFAULT_BREAKER, NOW)).toEqual({ open: false })
  })

  test('does not trip below the minimum sample, however bad it looks', () => {
    expect(breakerVerdict(outcomesOf(19, 0), DEFAULT_BREAKER, NOW)).toEqual({ open: false })
  })

  test('stays closed (probe) when the newest outcome is older than the window', () => {
    const stale = new Date(NOW.getTime() - 61 * 60_000).toISOString()
    expect(breakerVerdict(outcomesOf(20, 0, stale), DEFAULT_BREAKER, NOW)).toEqual({ open: false })
  })
})

describe('breakerVerdict under a persistent outage (multi-tick)', () => {
  test('latches shut and lets through at most one batch per silent hour', () => {
    // A tick every ten minutes for a day, every job failing whenever the
    // breaker is closed enough to let a batch run. This is the scenario F2
    // guards against: the old window-filtered reader re-closed as soon as the
    // failures aged out of the last hour, letting roughly minSamples + batch
    // failures through every hour indefinitely. Pure and deterministic: `now`
    // is driven by hand, nothing waits on a real clock.
    const start = new Date('2026-09-17T00:00:00.000Z')
    const tickMinutes = 10
    const ticksPerDay = (24 * 60) / tickMinutes
    const batch = 8

    let history: BreakerOutcome[] = []
    let totalFailed = 0

    for (let i = 0; i < ticksPerDay; i++) {
      const now = new Date(start.getTime() + i * tickMinutes * 60_000)
      // readRecentOutcomes returns the last minSamples finished jobs, however
      // old -- there is no time filter at the SQL level any more.
      const recent = history.slice(-DEFAULT_BREAKER.minSamples)
      const verdict = breakerVerdict(recent, DEFAULT_BREAKER, now)

      if (!verdict.open) {
        const finished: BreakerOutcome[] = Array.from({ length: batch }, () => ({
          status: 'failed',
          updatedAt: now.toISOString(),
        }))
        history = [...history, ...finished]
        totalFailed += batch
      }
    }

    // The ~20 it takes to trip, plus at most one batch per hour of silence
    // over the day, plus one more batch of slack for the boundary.
    expect(totalFailed).toBeLessThanOrEqual(20 + batch * 24 + batch)
  })
})

describe('readRecentOutcomes', () => {
  test('orders by updated_at desc, limits to minSamples, and fails closed on error', async () => {
    const calls: unknown[] = []
    const ok = {
      from: () => ({
        select: () => ({
          in: (_c: string, values: string[]) => ({
            order: (column: string, opts: { ascending: boolean }) => ({
              limit: async (limit: number) => {
                calls.push({ values, column, ascending: opts.ascending, limit })
                return {
                  data: [
                    { status: 'done', updated_at: '2026-09-17T11:59:00.000Z' },
                    { status: 'failed', updated_at: '2026-09-17T11:58:00.000Z' },
                  ],
                  error: null,
                }
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    expect(await readRecentOutcomes(ok, DEFAULT_BREAKER)).toEqual([
      { status: 'done', updatedAt: '2026-09-17T11:59:00.000Z' },
      { status: 'failed', updatedAt: '2026-09-17T11:58:00.000Z' },
    ])
    expect(calls).toEqual([
      { values: ['done', 'failed'], column: 'updated_at', ascending: false, limit: 20 },
    ])

    const broken = {
      from: () => ({
        select: () => ({
          in: () => ({
            order: () => ({ limit: async () => ({ data: null, error: { message: 'down' } }) }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(readRecentOutcomes(broken, DEFAULT_BREAKER)).rejects.toThrow('down')
  })
})
