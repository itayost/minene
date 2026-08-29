/**
 * @vitest-environment node
 *
 * Both CLI reports read `public.simulations` straight through a Supabase
 * client, with no test standing between them and the query. That query layer
 * is PostgREST, and PostgREST caps a response at a server-configured row
 * limit even when nothing in this repo asked it to -- so a fake here has to
 * model that cap, not just hand back whatever it is given, or the test would
 * pass against exactly the code that has the bug.
 */
import { describe, expect, test } from 'vitest'
import { fetchExperimentRows } from '../../scripts/experiment-report'
import { fetchSimulationRows } from '../../scripts/technique-report'

/** A `.select()...range()` chain that never answers with more than `cap` rows. */
function fakeTable<T>(rows: T[], cap: number) {
  const chain = {
    order: () => chain,
    not: () => chain,
    range: (from: number, to: number) => {
      const requested = rows.slice(from, to + 1)
      return Promise.resolve({ data: requested.slice(0, cap), error: null })
    },
  }
  return { from: () => ({ select: () => chain }) } as never
}

describe('report:techniques reads the whole table', () => {
  test('a history longer than one page is not read as though it stopped at the page', async () => {
    // The real query orders by created_at desc, so a page cap silently drops
    // the OLDEST rows first -- id 5000 here stands in for the earliest run
    // that a `.limit(5000)` would have dropped.
    const rows = Array.from({ length: 5200 }, () => ({
      outcome: 'agreed',
      turns: [],
      state: { fatigue: 0 },
      score: null,
      world: null,
      persona_id: null,
      plan: null,
    }))

    const result = await fetchSimulationRows(fakeTable(rows, 1000))
    expect(result).toHaveLength(5200)
  })
})

describe('report:experiment reads every run of an experiment', () => {
  test('an experiment with more runs than one page is not read as though it had fewer', async () => {
    const rows = Array.from({ length: 1400 }, () => ({
      experiment: 'message-length',
      variant: 'short-25',
      outcome: 'agreed',
      turns: [],
      score: null,
      models: null,
    }))

    const result = await fetchExperimentRows(fakeTable(rows, 1000))
    expect(result).toHaveLength(1400)
  })
})
