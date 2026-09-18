import { describe, expect, it } from 'vitest'
import type { StoredSimulation } from '../../src/persuade/lib/simulations'
import { matrixFrom } from '../../src/persuade/matrix-data'

const sim = (
  industry: string,
  jobRoleId: string,
  outcome: string,
  experiment: string | null = null,
): StoredSimulation => ({
  id: `s-${Math.random()}`,
  cell: { industry, jobRoleId },
  experiment,
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
      experiment: null,
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

describe('runs from an experiment arm', () => {
  it('are left out of the cell they would otherwise share with ordinary runs', () => {
    // queueExperiment (lib/experiments.ts) runs an arm under a RuleConfig
    // deliberately different from the deployed default -- e.g. messageLength-
    // Experiment caps replies at 25 or 45 words instead of the default. Those
    // jobs carry the same industry/job_role_id as an ordinary sweep run against
    // the same cell (see planExperiment), so without this exclusion a cell's
    // persuasion rate silently blends conversations that ran under two
    // different configs into one number that claims to describe the deployed
    // default alone.
    const cells = matrixFrom(
      [
        sim('אופנה', 'r1', 'agreed'),
        sim('אופנה', 'r1', 'agreed'),
        sim('אופנה', 'r1', 'refused', 'message-length'),
        sim('אופנה', 'r1', 'refused', 'message-length'),
        sim('אופנה', 'r1', 'refused', 'message-length'),
      ],
      roles,
    )

    // Pooled with the experiment runs this cell would read 2 of 5 agreed
    // (40%). Excluding them, it is 2 of 2 -- the true rate under the deployed
    // default, the only thing this screen claims to measure.
    const cell = cells.find((c) => c.industry === 'אופנה' && c.jobRoleId === 'r1')
    expect(cell).toMatchObject({ runs: 2, persuasionRate: 100 })
  })

  it('leaves a cell at "no runs" rather than crediting it with an experiment arm alone', () => {
    // A second role with an ordinary run keeps the 'אופנה' industry row on the
    // grid, so r1's cell is reachable to assert on: no comparable run landed
    // there, so it must read as unrun, not as one run at some rate.
    const cells = matrixFrom(
      [sim('אופנה', 'r1', 'agreed', 'message-length'), sim('אופנה', 'r2', 'agreed')],
      roles,
    )

    const cell = cells.find((c) => c.industry === 'אופנה' && c.jobRoleId === 'r1')
    expect(cell).toMatchObject({ runs: 0, persuasionRate: null })
  })
})
