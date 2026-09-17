/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import type { FeedReport } from '../../src/persuade/lib/feed'
import { type JobRow, type TickDeps, tick } from '../../src/persuade/lib/worker'
import type { WorkerSettings } from '../../src/persuade/lib/worker-settings'

const SETTINGS: WorkerSettings = {
  dailyCap: 1000,
  batch: 8,
  concurrency: 4,
  lowWater: 50,
  refillChunk: 200,
}

const job = (id: string): JobRow => ({
  id,
  experiment: null,
  variant: null,
  persona_key: 'adi',
  plan_key: 'briefings',
  industry: 'retail',
  segment: null,
  job_role_id: null,
  need: null,
  rules: DEFAULT_RULES,
  world: null,
  attempts: 1,
  pass: 0,
})

/** Today's count, the claim RPC, and the per-job status updates: the three things tick touches directly. */
function fakeClient(today: number, claimable: JobRow[]) {
  const updates: { id: string; status: unknown; error: unknown }[] = []
  const claims: { p_limit: number }[] = []
  const counted: { table: string; column: string }[] = []
  const client = {
    from: (table: string) => ({
      select: () => ({
        gte: async (column: string) => {
          counted.push({ table, column })
          return { count: today, error: null }
        },
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async (_column: string, id: string) => {
          updates.push({ id, status: patch.status, error: patch.error })
          return { error: null }
        },
      }),
    }),
    rpc: async (_fn: string, args: { p_limit: number }) => {
      claims.push(args)
      return { data: claimable.slice(0, args.p_limit), error: null }
    },
  } as unknown as SupabaseClient
  return { client, updates, claims, counted }
}

const quiet: FeedReport = { status: 'enough', pending: 100 }

const deps = (overrides: Partial<TickDeps> = {}): Partial<TickDeps> => ({
  settings: SETTINGS,
  readOutcomes: async () => [],
  refill: async () => quiet,
  runJob: async (_client, row) => `sim-${row.id}`,
  ...overrides,
})

describe('tick', () => {
  test('runs a claimed batch at most `concurrency` at a time', async () => {
    const { client, updates } = fakeClient(
      0,
      Array.from({ length: 8 }, (_, i) => job(`j${i}`)),
    )
    let active = 0
    let peak = 0

    const report = await tick(
      client,
      deps({
        runJob: async (_c, row) => {
          active += 1
          peak = Math.max(peak, active)
          await new Promise((resolve) => setTimeout(resolve, 5))
          active -= 1
          return `sim-${row.id}`
        },
      }),
    )

    expect(peak).toBe(4)
    expect(report).toEqual({ claimed: 8, completed: 8, failed: 0, feed: quiet })
    expect(updates.filter((u) => u.status === 'done')).toHaveLength(8)
  })

  test('claims no more than the room left under the cap', async () => {
    const { client, claims, counted } = fakeClient(
      997,
      Array.from({ length: 8 }, (_, i) => job(`j${i}`)),
    )
    const report = await tick(client, deps())
    expect(claims).toEqual([{ p_limit: 3, p_stale_minutes: 30 }])
    expect(report.claimed).toBe(3)
    // The cap counts attempts (jobs claimed today), not stored simulations.
    expect(counted).toEqual([{ table: 'simulation_jobs', column: 'claimed_at' }])
  })

  test('stops at the cap without refilling or claiming', async () => {
    const { client, claims } = fakeClient(1000, [job('j0')])
    let refilled = false
    const report = await tick(
      client,
      deps({
        refill: async () => {
          refilled = true
          return quiet
        },
      }),
    )
    expect(report).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      stopped: 'תקרה יומית: 1000/1000',
    })
    expect(claims).toHaveLength(0)
    expect(refilled).toBe(false)
  })

  test('the breaker stops the tick before it claims anything', async () => {
    const { client, claims } = fakeClient(0, [job('j0')])
    const report = await tick(
      client,
      deps({
        readOutcomes: async () =>
          Array.from({ length: 20 }, () => ({
            status: 'failed',
            updatedAt: new Date().toISOString(),
          })),
      }),
    )
    expect(report).toEqual({
      claimed: 0,
      completed: 0,
      failed: 0,
      stopped: 'מפסק: 20/20 נכשלו בשעה האחרונה',
    })
    expect(claims).toHaveLength(0)
  })

  test('a failed refill is reported and the tick still drains the queue', async () => {
    const { client } = fakeClient(0, [job('j0')])
    const report = await tick(
      client,
      deps({
        refill: async () => {
          throw new Error('rpc down')
        },
      }),
    )
    expect(report).toEqual({
      claimed: 1,
      completed: 1,
      failed: 0,
      feed: { status: 'error', message: 'rpc down' },
    })
  })

  test('one failing job is marked failed and does not stop the others', async () => {
    const { client, updates } = fakeClient(0, [job('ok'), job('bad'), job('ok2')])
    const report = await tick(
      client,
      deps({
        runJob: async (_c, row) => {
          if (row.id === 'bad') throw new Error('judge refused')
          return `sim-${row.id}`
        },
      }),
    )
    expect(report).toMatchObject({ claimed: 3, completed: 2, failed: 1 })
    expect(updates.find((u) => u.id === 'bad')).toEqual({
      id: 'bad',
      status: 'failed',
      error: 'judge refused',
    })
  })
})
