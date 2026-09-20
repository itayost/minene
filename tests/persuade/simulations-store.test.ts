import { describe, expect, it } from 'vitest'
import type { Run } from '../../src/persuade/engine/types'
import { createSimulationsStore } from '../../src/persuade/lib/simulations'

type Row = Record<string, unknown>

function fake(rows: Row[] = []) {
  const inserted: Row[] = []
  let selected = ''
  const client = {
    from: () => {
      // Real PostgREST order() chains: each call adds a column, the first is
      // primary and later ones only break ties in the columns before it --
      // so a caller that adds `.order('id', ...)` after `.order('created_at',
      // ...)` is actually exercised here instead of silently overwritten.
      const orderCols: { column: string; ascending: boolean }[] = []
      const q = {
        insert: (values: Row) => {
          inserted.push(values)
          return q
        },
        select: (cols: string) => {
          selected = cols
          return q
        },
        // A real read is select().order().range(from, to) -- paged, so a table
        // bigger than one page has to come back as more than one page.
        order: (column: string, options?: { ascending?: boolean }) => {
          orderCols.push({ column, ascending: options?.ascending !== false })
          return q
        },
        range: async (from: number, to: number) => {
          const sorted = [...rows].sort((a, b) => {
            for (const { column, ascending } of orderCols) {
              const left = String(a[column] ?? '')
              const right = String(b[column] ?? '')
              if (left === right) continue
              return ascending ? left.localeCompare(right) : right.localeCompare(left)
            }
            return 0
          })
          return { data: sorted.slice(from, to + 1), error: null }
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
      }
      return q
    },
  } as never
  return { store: createSimulationsStore(client), inserted, selectedColumns: () => selected }
}

const run = (over: Partial<Run> = {}) =>
  ({
    id: 'sim-1',
    createdAt: '2026-08-27T10:00:00Z',
    planId: 'p1',
    personaId: 'rona',
    plan: { id: 'p1', ask: { what: 'תדריך יומי' } },
    persona: { id: 'rona' },
    turns: [{ role: 'persuader', text: 'שלום', interaction: 1 }],
    state: { outcome: 'agreed', blockers: ['overloaded'], interaction: 2 },
    violations: [],
    ...over,
  }) as unknown as Run

describe('saving a simulation', () => {
  it('writes the matrix coordinates, because the cell is what it belongs to', async () => {
    const { store, inserted } = fake()
    await store.saveSimulation(run(), { industry: 'אופנה', jobRoleId: 'r1', need: null })

    expect(inserted[0]).toMatchObject({ industry: 'אופנה', job_role_id: 'r1', persona_id: 'rona' })
  })

  it('never writes a tenant, because that column deliberately does not exist', async () => {
    const { store, inserted } = fake()
    await store.saveSimulation(run(), { industry: 'אופנה', jobRoleId: 'r1', need: null })

    // The bank is shared across tenants precisely because a simulation carries
    // no tenant's knowledge. Writing one would make the table lie about that.
    expect(inserted[0]).not.toHaveProperty('tenant_id')
    expect(inserted[0]).not.toHaveProperty('assignment_id')
  })

  it('records which models ran it, so the row is attributable evidence', async () => {
    const { store, inserted } = fake()
    await store.saveSimulation(run(), { industry: 'אופנה', jobRoleId: 'r1', need: null })

    // The worker recorded this and the lab writer did not, so every run started
    // from the UI was unattributable. The readers tolerate unattributed rows
    // because of a historical backfill, which meant a live writer omitting the
    // column produced no complaint from anything -- it just quietly widened the
    // set of runs no comparison can safely span.
    expect(inserted[0]).toHaveProperty('models')
    expect(inserted[0]?.models).toMatchObject({
      persuader: expect.any(String),
      target: expect.any(String),
      judge: expect.any(String),
    })
  })

  it('persists the score, which is the whole reason the bank can exist', async () => {
    const scored = run({
      score: {
        winningCategory: 'numbers',
        winningArgument: 'פי שלוש',
        grade: 80,
        responseValidity: 'did',
      },
    } as never)
    const { store, inserted } = fake()
    await store.saveSimulation(scored, { industry: 'אופנה', jobRoleId: 'r1', need: null })

    // conversations drops score on save, and buildBank keys off it -- so a bank
    // built from stored runs came back empty however many had been scored.
    expect(inserted[0]).toMatchObject({ score: { winningCategory: 'numbers' } })
  })

  it('writes a null score rather than omitting it when nothing scored the run', async () => {
    const { store, inserted } = fake()
    await store.saveSimulation(run(), { industry: 'אופנה', jobRoleId: 'r1', need: null })

    // Null means not yet scored. Absent would be indistinguishable from a
    // column that was never written at all.
    expect(inserted[0]).toHaveProperty('score', null)
  })
})

/**
 * Simulates a row landing between two paged requests, the way the hourly
 * worker's live inserts do against a real table. `order()` records every
 * column it was called with, in order, so a caller that adds a tiebreaker
 * column is actually exercised rather than silently ignored.
 */
function fakeWithConcurrentInsert(initialRows: Row[], insertBeforeCall: number) {
  let rows = [...initialRows]
  let calls = 0
  const client = {
    from: () => {
      const orderCols: { column: string; ascending: boolean }[] = []
      const q = {
        select: () => q,
        order: (column: string, options?: { ascending?: boolean }) => {
          orderCols.push({ column, ascending: options?.ascending !== false })
          return q
        },
        range: async (from: number, to: number) => {
          calls += 1
          if (calls === insertBeforeCall) {
            // A run the worker just saved: newer than everything already read,
            // so it sorts to the very front of a newest-first query.
            rows = [
              {
                id: 'sim-new',
                industry: 'אופנה',
                job_role_id: 'r1',
                persona_id: 'rona',
                plan: { id: 'p1' },
                turns: [],
                state: { outcome: 'agreed', blockers: [], interaction: 1 },
                score: null,
                created_at: '2099-01-01T00:00:00Z',
              },
              ...rows,
            ]
          }
          const sorted = [...rows].sort((a, b) => {
            for (const { column, ascending } of orderCols) {
              const left = String(a[column] ?? '')
              const right = String(b[column] ?? '')
              if (left === right) continue
              return ascending ? left.localeCompare(right) : right.localeCompare(left)
            }
            return 0
          })
          return { data: sorted.slice(from, to + 1), error: null }
        },
      }
      return q
    },
  } as never
  return createSimulationsStore(client)
}

describe('reading simulations back', () => {
  it('selects the score, or the bank has nothing to read', async () => {
    const { store, selectedColumns } = fake()
    await store.listSimulations()

    expect(selectedColumns()).toContain('score')
  })

  it('rebuilds a run the bank and the rates can use', async () => {
    const { store } = fake([
      {
        id: 'sim-1',
        industry: 'אופנה',
        job_role_id: 'r1',
        persona_id: 'rona',
        plan: { id: 'p1' },
        turns: [{ role: 'persuader', text: 'שלום', interaction: 1 }],
        state: { outcome: 'agreed', blockers: ['overloaded'], interaction: 2 },
        score: {
          winningCategory: 'numbers',
          winningArgument: 'פי שלוש',
          grade: 80,
          responseValidity: 'did',
        },
        created_at: '2026-08-27T10:00:00Z',
      },
    ])

    const [first] = await store.listSimulations()

    expect(first?.run.state.outcome).toBe('agreed')
    expect(first?.run.score?.winningCategory).toBe('numbers')
    expect(first?.cell).toEqual({ industry: 'אופנה', jobRoleId: 'r1' })
  })

  it('returns every simulation, not just the newest page of them', async () => {
    // The matrix and the bank read this list and trust it is the whole table --
    // neither warns about a sample. A table larger than one page silently
    // losing its older rows is exactly the failure this store's own comments
    // (and the matrix's, and the bank's) say to never let happen: a smaller
    // number shown confidently instead of the real one.
    const row = (i: number): Row => ({
      id: `sim-${i}`,
      industry: 'אופנה',
      job_role_id: 'r1',
      persona_id: 'rona',
      plan: { id: 'p1' },
      turns: [],
      state: { outcome: 'agreed', blockers: [], interaction: 1 },
      score: null,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    })
    const total = 650
    const { store } = fake(Array.from({ length: total }, (_, i) => row(i)))

    const all = await store.listSimulations()

    expect(all).toHaveLength(total)
  })

  it('does not double-count or lose a run the worker saves while it is still paging', async () => {
    // scripts/lib/db.ts's readAll (used by both report scripts) reads
    // oldest-first with `id` as a tiebreaker specifically because a
    // newest-first page, re-requested after a live insert, shifts every
    // unread row down by one -- the row at the trailing edge of the page just
    // read reappears at the leading edge of the next one, counted twice,
    // while the row that was actually inserted (now at the very front of a
    // newest-first order) is skipped entirely, since the cursor has already
    // moved past where it would have landed. This store still reads
    // newest-first with no tiebreaker at all, so it is exposed to the exact
    // failure its sibling readers were fixed to avoid -- and it is the one
    // the lab's live matrix and bank are built from.
    const row = (i: number): Row => ({
      id: `sim-${i}`,
      industry: 'אופנה',
      job_role_id: 'r1',
      persona_id: 'rona',
      plan: { id: 'p1' },
      turns: [],
      state: { outcome: 'agreed', blockers: [], interaction: 1 },
      score: null,
      created_at: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    })
    const initial = Array.from({ length: 8 }, (_, i) => row(i))
    // Page size 5 forces a second request, and the insert lands right before
    // it -- the same window a live worker tick falls into.
    const store = fakeWithConcurrentInsert(initial, 2)

    const all = await store.listSimulations(5)

    const ids = all.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('sim-new')
  })
})
