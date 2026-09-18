import { describe, expect, it } from 'vitest'
import type { Run } from '../../src/persuade/engine/types'
import { createSimulationsStore } from '../../src/persuade/lib/simulations'

type Row = Record<string, unknown>

function fake(rows: Row[] = []) {
  const inserted: Row[] = []
  let selected = ''
  const client = {
    from: () => {
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
