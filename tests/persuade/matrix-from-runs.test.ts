import { describe, expect, it } from 'vitest'
import type { StoredSimulation } from '../../src/persuade/lib/simulations'
import { matrixFrom } from '../../src/persuade/matrix-data'

const sim = (
  industry: string,
  jobRoleId: string,
  outcome: string,
  models: Record<string, string> | null = null,
): StoredSimulation => ({
  id: `s-${Math.random()}`,
  cell: { industry, jobRoleId },
  run: { state: { outcome, blockers: [], interaction: 3 }, violations: [] } as never,
  models,
})

const roles = [
  { id: 'r1', name: 'מנהלת חנות' },
  { id: 'r2', name: 'מוכרת' },
]

describe('turning runs into a matrix', () => {
  it('computes a cell’s rate from the runs in it', () => {
    const cells = matrixFrom(
      [
        sim('אופנה', 'r1', 'agreed'),
        sim('אופנה', 'r1', 'agreed'),
        sim('אופנה', 'r1', 'refused'),
        sim('אופנה', 'r1', 'refused'),
      ],
      roles,
    )

    const cell = cells.find((c) => c.industry === 'אופנה' && c.jobRoleId === 'r1')
    expect(cell).toMatchObject({ runs: 4, persuasionRate: 50 })
  })

  it('gives an unrun cell a null rate, never zero', () => {
    const cells = matrixFrom([sim('אופנה', 'r1', 'agreed')], roles)

    // Every role gets a cell so the grid is rectangular, but a cell nobody has
    // run is an absence, not a measurement of total failure.
    const empty = cells.find((c) => c.jobRoleId === 'r2')
    expect(empty).toMatchObject({ runs: 0, persuasionRate: null })
  })

  it('builds a rectangular grid, so a row can be read across', () => {
    const cells = matrixFrom([sim('אופנה', 'r1', 'agreed'), sim('מזון', 'r2', 'refused')], roles)

    // Two industries, two roles: four cells, even though only two were run.
    // A ragged grid cannot be scanned, which is the matrix's only job.
    expect(cells).toHaveLength(4)
  })

  it('carries no industry that has no runs at all', () => {
    const cells = matrixFrom([sim('אופנה', 'r1', 'agreed')], roles)

    // The rows come from the data. Inventing sectors nobody has touched would
    // fill the screen with hatching that says nothing.
    expect(new Set(cells.map((c) => c.industry))).toEqual(new Set(['אופנה']))
  })
})

describe('a cell that spans a persuader-model swap', () => {
  const gpt4o = { persuader: 'gpt-4o-mini', target: 'gpt-4o-mini', judge: 'gpt-4o-mini' }
  const gpt5 = { persuader: 'gpt-5', target: 'gpt-4o-mini', judge: 'gpt-4o-mini' }

  it('flags a cell whose runs carry two different recorded fingerprints', () => {
    const cells = matrixFrom(
      [sim('אופנה', 'r1', 'agreed', gpt4o), sim('אופנה', 'r1', 'refused', gpt5)],
      roles,
    )

    const cell = cells.find((c) => c.industry === 'אופנה' && c.jobRoleId === 'r1')
    // 50% persuasion here is a blend of two model generations, not one
    // measurement of the industry-role pair -- the reader has no way to see
    // that from the rate alone.
    expect(cell).toMatchObject({ runs: 2, persuasionRate: 50, modelsMixed: true })
  })

  it('does not flag a cell whose runs share one fingerprint', () => {
    const cells = matrixFrom(
      [sim('אופנה', 'r1', 'agreed', gpt4o), sim('אופנה', 'r1', 'refused', gpt4o)],
      roles,
    )

    const cell = cells.find((c) => c.industry === 'אופנה' && c.jobRoleId === 'r1')
    expect(cell?.modelsMixed).toBe(false)
  })

  it('does not flag a cell where the model was simply never recorded', () => {
    // A run predating the `models` column is an unknown, not a second model --
    // counting it as one would flag every cell that spans the day the column
    // was added, on no evidence of an actual swap.
    const cells = matrixFrom(
      [sim('אופנה', 'r1', 'agreed', gpt4o), sim('אופנה', 'r1', 'refused', null)],
      roles,
    )

    const cell = cells.find((c) => c.industry === 'אופנה' && c.jobRoleId === 'r1')
    expect(cell?.modelsMixed).toBe(false)
  })
})

describe('runs that carry no role', () => {
  const sim = (industry: string, jobRoleId: string | null, outcome: string) =>
    ({
      id: `${industry}-${jobRoleId}-${outcome}-${Math.random()}`,
      cell: { industry, jobRoleId },
      run: { state: { outcome } },
    }) as never

  it('gets its own column instead of vanishing', () => {
    // A sweep of the world space is tenant-free by design and public.roles is
    // per-tenant, so those runs carry no role id. They used to match no column
    // and disappear -- seven of eleven runs were invisible the first time this
    // was looked at, which is the worst way for a measurement screen to be
    // wrong: a smaller number, shown confidently.
    const cells = matrixFrom(
      [
        sim('retail', 'r1', 'agreed'),
        sim('retail', null, 'agreed'),
        sim('retail', null, 'refused'),
      ],
      [{ id: 'r1', name: 'מנהל חנות' }],
    )

    expect(cells.reduce((n, c) => n + c.runs, 0)).toBe(3)
    const unassigned = cells.find((c) => c.jobRoleId === null)
    expect(unassigned?.runs).toBe(2)
    expect(unassigned?.persuasionRate).toBe(50)
  })

  it('is absent when every run records a role', () => {
    const cells = matrixFrom([sim('retail', 'r1', 'agreed')], [{ id: 'r1', name: 'מנהל חנות' }])
    expect(cells.every((c) => c.jobRoleId !== null)).toBe(true)
  })

  it('does not vanish a run whose role id matches none of the current catalogue', () => {
    // job_role_id is set when the job is queued, against the catalogue as it
    // stood then. Roles are hard-deleted (see roles-api.ts's deleteRole), so a
    // run recorded weeks ago can carry an id no role here answers to. That run
    // is not "no role" (jobRoleId is not null) and it is not any known column
    // either -- exactly the join failure this file already fixed once for the
    // null case, just for a non-null id instead.
    const cells = matrixFrom(
      [sim('retail', 'deleted-role', 'agreed')],
      [{ id: 'r1', name: 'מנהל חנות' }],
    )

    expect(cells.reduce((n, c) => n + c.runs, 0)).toBe(1)
  })
})
