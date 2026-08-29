import { describe, expect, it } from 'vitest'
import type { StoredSimulation } from '../../src/persuade/lib/simulations'
import { matrixFrom } from '../../src/persuade/matrix-data'

const sim = (industry: string, jobRoleId: string, outcome: string): StoredSimulation => ({
  id: `s-${Math.random()}`,
  cell: { industry, jobRoleId },
  run: { state: { outcome, blockers: [], interaction: 3 }, violations: [] } as never,
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
})
