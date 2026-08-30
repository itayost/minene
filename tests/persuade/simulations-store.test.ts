import { describe, expect, it } from 'vitest'
import type { Run } from '../../src/persuade/engine/types'
import { createSimulationsStore } from '../../src/persuade/lib/simulations'

type Row = Record<string, unknown>

function fake(rows: Row[] = []) {
  const inserted: Row[] = []
  let selected = ''
  const client = {
    from: () => {
      // Mirrors what Postgres actually does with .order().limit(): sorts the
      // whole table by the column, then cuts. A fake that ignored the argument
      // (as this one used to) could never catch a limit that was too small --
      // it would return every row regardless of what was asked for.
      let paged = rows
      const q = {
        insert: (values: Row) => {
          inserted.push(values)
          return q
        },
        select: (cols: string) => {
          selected = cols
          return q
        },
        order: (column: string, opts?: { ascending?: boolean }) => {
          const ascending = opts?.ascending ?? true
          paged = [...rows].sort((a, b) => {
            const left = String(a[column] ?? '')
            const right = String(b[column] ?? '')
            return ascending ? left.localeCompare(right) : right.localeCompare(left)
          })
          return q
        },
        limit: (n: number) => {
          paged = paged.slice(0, n)
          return q
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: paged, error: null }),
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

  it('persists the score, which is the whole reason the bank can exist', async () => {
    const scored = run({
      score: { winningCategory: 'numbers', winningArgument: 'פי שלוש', grade: 80 },
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
        score: { winningCategory: 'numbers', winningArgument: 'פי שלוש', grade: 80 },
        created_at: '2026-08-27T10:00:00Z',
      },
    ])

    const [first] = await store.listSimulations()

    expect(first?.run.state.outcome).toBe('agreed')
    expect(first?.run.score?.winningCategory).toBe('numbers')
    expect(first?.cell).toEqual({ industry: 'אופנה', jobRoleId: 'r1' })
  })

  it('does not let its default page size silently drop an industry from the matrix', async () => {
    // The worker can log up to 144 runs a day (worker.ts's batch-size comment:
    // six an hour, under the 200 daily cap) and never stops -- so any fixed page
    // size is a matter of when, not if, it is exceeded. Once it is, the oldest
    // industry's runs fall off the page and its matrix cell reads back with zero
    // runs: indistinguishable from an industry nobody has ever simulated, which is
    // the exact "smaller number, shown confidently" failure the roleless-run fix
    // above exists to prevent -- recurring here through a LIMIT instead of a join.
    const oldest = {
      id: 'old',
      industry: 'תעשייה',
      job_role_id: 'r1',
      persona_id: null,
      plan: { id: 'p' },
      turns: [],
      state: { outcome: 'agreed' },
      score: null,
      created_at: '2020-01-01T00:00:00Z',
    }
    const flood = Array.from({ length: 500 }, (_, i) => ({
      id: `flood-${i}`,
      industry: 'קמעונאות',
      job_role_id: 'r2',
      persona_id: null,
      plan: { id: 'p' },
      turns: [],
      state: { outcome: 'refused' },
      score: null,
      created_at: '2026-01-01T00:00:00Z',
    }))
    const { store } = fake([oldest, ...flood])

    const all = await store.listSimulations()

    expect(all.some((s) => s.id === 'old')).toBe(true)
  })
})
