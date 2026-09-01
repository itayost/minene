/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { fetchExperimentRows } from '../../scripts/experiment-report'

type Row = Record<string, unknown>

/**
 * Stands in for PostgREST: a query built with `.range()` returns exactly that
 * page, and a query awaited without ever calling `.range()` still comes back
 * capped at the server's own default row limit -- silently, the same way a
 * real Supabase project does. `simulations-store.test.ts`'s fake client makes
 * the identical distinction for `listSimulations`.
 */
function fakeClient(rows: Row[], implicitCap = 1000) {
  const q = {
    select: () => q,
    not: () => q,
    order: () => q,
    range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }),
    then: (resolve: (v: { data: Row[]; error: null }) => unknown) =>
      resolve({ data: rows.slice(0, implicitCap), error: null }),
  }
  return { from: () => q } as unknown as SupabaseClient
}

describe('reading experiment rows back', () => {
  it('returns every row, not just the first page PostgREST hands back on its own', async () => {
    // The report groups by experiment and compares arms by count -- a page cut
    // partway through a long-running experiment does not just shrink the
    // total, it can shrink one arm more than the other and print a lopsided
    // comparison for an experiment that was not lopsided at all.
    const total = 1400
    const rows: Row[] = Array.from({ length: total }, (_, i) => ({
      experiment: 'exp-a',
      variant: i % 2 === 0 ? 'control' : 'treatment',
      outcome: 'agreed',
      turns: [],
      score: null,
      models: null,
    }))

    const result = await fetchExperimentRows(fakeClient(rows, 1000))

    expect(result).toHaveLength(total)
  })

  it('stops once a page comes back short, rather than looping forever', async () => {
    const rows: Row[] = Array.from({ length: 3 }, () => ({
      experiment: 'exp-a',
      variant: 'control',
      outcome: 'agreed',
      turns: [],
      score: null,
      models: null,
    }))

    const result = await fetchExperimentRows(fakeClient(rows, 1000))

    expect(result).toHaveLength(3)
  })
})
