import { describe, expect, it } from 'vitest'
import type { Run } from '../../src/persuade/engine/types'
import { createSimulationsStore } from '../../src/persuade/lib/simulations'

type Row = Record<string, unknown>

function fake(rows: Row[] = []) {
  const inserted: Row[] = []
  let selected = ''
  let table = ''
  // Which column and value a count reader filtered on, or null when it did not
  // filter at all. Recording this (and the table above) is what lets a test
  // tell `simulations` from `simulation_jobs`, and `created_at` from
  // `claimed_at` -- a fake that only returns the row count cannot.
  let gteCall: { column: string; value: unknown } | null = null
  const client = {
    from: (tableName: string) => {
      table = tableName
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
          const sorted = [...rows].sort((a, b) => {
            const left = String(a[column] ?? '')
            const right = String(b[column] ?? '')
            return options?.ascending === false
              ? right.localeCompare(left)
              : left.localeCompare(right)
          })
          return {
            range: async (from: number, to: number) => ({
              data: sorted.slice(from, to + 1),
              error: null,
            }),
          }
        },
        gte: (column: string, value: unknown) => {
          gteCall = { column, value }
          return q
        },
        then: (resolve: (v: unknown) => unknown) =>
          resolve({ data: rows, error: null, count: rows.length }),
      }
      return q
    },
  } as never
  return {
    store: createSimulationsStore(client),
    inserted,
    selectedColumns: () => selected,
    selectedTable: () => table,
    gteCall: () => gteCall,
  }
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
})

describe('reading without the conversations', () => {
  it('does not ask for turns', () => {
    const { store, selectedColumns } = fake([])
    void store.listSimulationSummaries()

    // turns is the heaviest column by far and nothing on the lab screen reads
    // it. Selecting it anyway is the difference between a few megabytes and a
    // few hundred once the loop is running at its cap.
    expect(selectedColumns()).not.toContain('turns')
    expect(selectedColumns()).toContain('score')
    expect(selectedColumns()).toContain('state')
  })

  it('still produces a usable run for the bank and the rate', async () => {
    const { store } = fake([
      {
        id: 'sim-1',
        industry: 'retail',
        job_role_id: null,
        need: 'profitability',
        persona_id: 'rona',
        plan: { id: 'gen-retail-ceo-profitability' },
        state: { outcome: 'agreed', blockers: ['overloaded'], interaction: 3 },
        score: { winningCategory: 'numbers', winningArgument: 'המספרים', persuaded: 'yes' },
        created_at: '2026-09-22T10:00:00Z',
      },
    ])

    const rows = await store.listSimulationSummaries()

    expect(rows[0]?.run.state.outcome).toBe('agreed')
    expect(rows[0]?.run.score?.winningCategory).toBe('numbers')
    // A row read without turns has no violations to derive, and says so as an
    // empty list rather than as undefined.
    expect(rows[0]?.run.turns).toEqual([])
    expect(rows[0]?.run.violations).toEqual([])
  })
})

describe('counting without reading', () => {
  // Each of these asserts the table and the filter column, not just the
  // returned number. A fake that only checked the count would still pass if
  // a reader were pointed at the wrong table or the wrong column -- which is
  // exactly the bug that would silently restore the lie the two separate
  // counters (runs added vs. attempts spent) exist to prevent.

  it('counts every simulation, with no since filter', async () => {
    const rows: Row[] = Array.from({ length: 7 }, (_, i) => ({ id: `sim-${i}` }))
    const { store, selectedTable, gteCall } = fake(rows)

    const count = await store.countSimulations()

    expect(count).toBe(7)
    expect(selectedTable()).toBe('simulations')
    expect(gteCall()).toBeNull()
  })

  it('counts simulations created since the given time, from the simulations table', async () => {
    const rows: Row[] = Array.from({ length: 3 }, (_, i) => ({ id: `sim-${i}` }))
    const { store, selectedTable, gteCall } = fake(rows)

    const count = await store.countSimulationsSince('2026-09-22T00:00:00Z')

    expect(count).toBe(3)
    expect(selectedTable()).toBe('simulations')
    expect(gteCall()).toEqual({ column: 'created_at', value: '2026-09-22T00:00:00Z' })
  })

  it('counts attempts claimed since the given time, from simulation_jobs rather than simulations', async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({ id: `job-${i}` }))
    const { store, selectedTable, gteCall } = fake(rows)

    const count = await store.countAttemptsSince('2026-09-22T00:00:00Z')

    // simulation_jobs, not simulations, and claimed_at, not created_at: this is
    // what the daily cap counts (worker.ts's attemptsToday), because a failed
    // job has already spent its model calls. Pointing this at the wrong table
    // or column would understate the spend without failing loudly anywhere
    // else -- these two assertions are the only thing that would catch it.
    expect(count).toBe(5)
    expect(selectedTable()).toBe('simulation_jobs')
    expect(gteCall()).toEqual({ column: 'claimed_at', value: '2026-09-22T00:00:00Z' })
  })
})
