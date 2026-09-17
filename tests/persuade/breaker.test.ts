/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { breakerVerdict, DEFAULT_BREAKER, readRecentOutcomes } from '../../src/persuade/lib/breaker'

const statuses = (failed: number, done: number) => [
  ...Array.from({ length: failed }, () => 'failed'),
  ...Array.from({ length: done }, () => 'done'),
]

describe('breakerVerdict', () => {
  test('trips when more than 80% of at least 20 finished jobs failed', () => {
    expect(breakerVerdict(statuses(17, 3), DEFAULT_BREAKER)).toEqual({
      open: true,
      failed: 17,
      total: 20,
    })
  })

  test('does not trip at exactly 80%', () => {
    expect(breakerVerdict(statuses(16, 4), DEFAULT_BREAKER)).toEqual({ open: false })
  })

  test('does not trip below the minimum sample, however bad it looks', () => {
    expect(breakerVerdict(statuses(19, 0), DEFAULT_BREAKER)).toEqual({ open: false })
  })
})

describe('readRecentOutcomes', () => {
  test('reads finished jobs inside the window and fails closed on error', async () => {
    const calls: unknown[] = []
    const ok = {
      from: () => ({
        select: () => ({
          in: (_c: string, values: string[]) => ({
            gte: (_col: string, since: string) => ({
              limit: async () => {
                calls.push({ values, since })
                return { data: [{ status: 'done' }, { status: 'failed' }], error: null }
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    const now = new Date('2026-09-17T12:00:00.000Z')
    expect(await readRecentOutcomes(ok, DEFAULT_BREAKER, now)).toEqual(['done', 'failed'])
    expect(calls).toEqual([{ values: ['done', 'failed'], since: '2026-09-17T11:00:00.000Z' }])

    const broken = {
      from: () => ({
        select: () => ({
          in: () => ({
            gte: () => ({ limit: async () => ({ data: null, error: { message: 'down' } }) }),
          }),
        }),
      }),
    } as unknown as SupabaseClient
    await expect(readRecentOutcomes(broken, DEFAULT_BREAKER, now)).rejects.toThrow('down')
  })
})
