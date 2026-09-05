/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { fetchSimulationRows } from '../../scripts/export-dataset'

type Row = Record<string, unknown>

/**
 * Stands in for PostgREST: a query built with `.range()` returns exactly that
 * page. `.limit()` is modeled too, because the pre-fix bug was not a bare
 * unbounded query (PostgREST's own default cap) but an explicit `.limit(5000)`
 * -- the fake has to be able to reproduce that exact call to prove the old
 * code silently truncated at 5000 rather than reading everything.
 */
function fakeClient(rows: Row[]) {
  const q = {
    select: () => q,
    order: () => q,
    limit: async (n: number) => ({ data: rows.slice(0, n), error: null }),
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
  }
  return { from: () => q } as unknown as SupabaseClient
}

describe('reading simulation rows for export', () => {
  it('returns every row, not just the first 5000', async () => {
    // A sweep plus a running experiment crosses 5000 stored simulations well
    // within the lab's lifetime. Past that, the old `.limit(5000)` read a
    // subset of the history while `export:dataset` printed it as a run over
    // everything -- the exact "reports on a subset while looking like a
    // report on everything" shape already fixed for technique-report.ts and
    // experiment-report.ts, just never applied here.
    const total = 6000
    const rows: Row[] = Array.from({ length: total }, (_, i) => ({
      id: `sim-${i}`,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      plan: null,
      persona_id: null,
      turns: [],
      state: { outcome: 'refused' },
      score: null,
      rules: null,
      models: null,
      experiment: null,
      variant: null,
    }))

    const result = await fetchSimulationRows(fakeClient(rows))

    expect(result).toHaveLength(total)
  })

  it('stops once a page comes back short, rather than looping forever', async () => {
    const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({
      id: `sim-${i}`,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
      plan: null,
      persona_id: null,
      turns: [],
      state: { outcome: 'refused' },
      score: null,
      rules: null,
      models: null,
      experiment: null,
      variant: null,
    }))

    const result = await fetchSimulationRows(fakeClient(rows))

    expect(result).toHaveLength(3)
  })
})
