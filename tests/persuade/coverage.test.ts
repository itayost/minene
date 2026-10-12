import { describe, expect, it } from 'vitest'
import { cellIndex, type RoleNeed } from '../../src/persuade/cell'
import { coverageOf, gridFrom, placeAll, runsForRole } from '../../src/persuade/coverage'
import type { StoredSimulation } from '../../src/persuade/lib/simulations'
import { taxonomyFrom } from '../../src/persuade/taxonomy'

const need = (industry: string, roleSlug: string, needKey: string): RoleNeed => ({
  industry,
  roleSlug,
  roleLabel: `תפקיד ${roleSlug}`,
  roleOrder: 1,
  needKey,
  needLabel: `צורך ${needKey}`,
  metaNeed: 'control',
})

const needs = [
  need('retail', 'ceo', 'profitability'),
  need('retail', 'ceo', 'chain-visibility'),
  need('bank', 'teller', 'service-quality'),
]

const taxonomy = taxonomyFrom(needs.map((n, i) => ({ ...n, needOrder: i + 1 })))
const index = cellIndex(needs)

const sim = (planId: string, outcome: string, experiment: string | null = null): StoredSimulation =>
  ({
    id: `s-${planId}-${outcome}-${Math.random()}`,
    cell: { industry: 'ignored', jobRoleId: null },
    experiment,
    run: { plan: { id: planId }, state: { outcome, blockers: [] } },
  }) as never

describe('placing runs on the taxonomy', () => {
  it('groups runs by their cell', () => {
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'refused'),
    ])

    expect(placed.runsByCell.get('retail/ceo/profitability')).toHaveLength(2)
  })

  it('counts a run outside the taxonomy instead of dropping it', () => {
    // Every one of the 168 runs on record carries the briefings plan, which
    // belongs to no cell. Dropping them would make the screen claim the table
    // is empty while showing a total of 168 elsewhere.
    const placed = placeAll(index, [sim('briefings', 'agreed'), sim('briefings', 'refused')])

    expect(placed.unplaced).toBe(2)
    expect(placed.runsByCell.size).toBe(0)
  })

  it('never loses a run: placed plus unplaced is the total', () => {
    const sims = [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('briefings', 'agreed'),
      sim('gen-bank-teller-service-quality', 'refused'),
    ]
    const placed = placeAll(index, sims)

    const inCells = [...placed.runsByCell.values()].reduce((n, runs) => n + runs.length, 0)
    expect(inCells + placed.unplaced).toBe(sims.length)
  })

  it('excludes an experiment-arm run from its cell entirely', () => {
    // queueExperiment() stamps the same industry/plan an ordinary sweep job
    // would carry for the same cell (planExperiment in experiments.ts), and
    // runJob() writes the row with that cell's plan id. An arm run under a
    // RuleConfig nobody deployed is not comparable to the cell's ordinary
    // runs -- pooling it in is the same "pooling populations that are not
    // comparable" failure #48 already fixed for the matrix this screen
    // replaced (matrix-data.ts, deleted 2026-09-22) and never reached here.
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'refused', 'message-length'),
    ])

    expect(placed.runsByCell.get('retail/ceo/profitability')).toHaveLength(1)
  })

  it('does not count an excluded experiment-arm run as unplaced either', () => {
    // It has a real, resolvable cell -- it is excluded for comparability, not
    // because the taxonomy does not know it. Counting it as unplaced would
    // misreport it as a taxonomy gap instead of a deliberate exclusion.
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed', 'message-length'),
    ])

    expect(placed.runsByCell.has('retail/ceo/profitability')).toBe(false)
    expect(placed.unplaced).toBe(0)
  })
})

describe('coverage of a set of runs', () => {
  it('is the share that agreed', () => {
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'refused'),
      sim('gen-retail-ceo-profitability', 'refused'),
    ])

    expect(coverageOf(placed.runsByCell.get('retail/ceo/profitability') ?? [])).toEqual({
      runs: 4,
      persuasionRate: 50,
    })
  })

  it('is null, never zero, when nothing has been run', () => {
    expect(coverageOf([])).toEqual({ runs: 0, persuasionRate: null })
  })

  it('is not moved by an experiment arm run under the cell', () => {
    // Same concrete case as #48 made for the old matrix: queue
    // messageLengthExperiment against a (persona, plan) pair tied to this
    // cell, and its losing arm's refusal would otherwise drag the headline
    // rate down for a setting nobody deployed.
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-profitability', 'refused', 'message-length'),
      sim('gen-retail-ceo-profitability', 'refused', 'message-length'),
    ])

    expect(coverageOf(placed.runsByCell.get('retail/ceo/profitability') ?? [])).toEqual({
      runs: 2,
      persuasionRate: 100,
    })
  })
})

describe('the grid', () => {
  it('carries every industry and role in the taxonomy, run or not', () => {
    const grid = gridFrom(taxonomy, placeAll(index, []))

    // Two industries, one role each. None of them has a single run, and all of
    // them are on screen: the hole is the finding.
    expect(grid).toHaveLength(2)
    expect(grid.every((cell) => cell.runs === 0 && cell.persuasionRate === null)).toBe(true)
  })

  it('sums a role’s needs into its cell', () => {
    const grid = gridFrom(
      taxonomy,
      placeAll(index, [
        sim('gen-retail-ceo-profitability', 'agreed'),
        sim('gen-retail-ceo-chain-visibility', 'refused'),
      ]),
    )

    const retail = grid.find((c) => c.industry === 'retail' && c.roleSlug === 'ceo')
    expect(retail).toMatchObject({ runs: 2, persuasionRate: 50 })
  })

  it('labels the industry and the role in Hebrew', () => {
    const grid = gridFrom(taxonomy, placeAll(index, []))

    expect(grid[0]?.industryLabel).toMatch(/[֐-׿]/)
    expect(grid[0]?.roleLabel).toMatch(/[֐-׿]/)
  })
})

describe('the runs behind one role', () => {
  it('gathers every need of that role', () => {
    const placed = placeAll(index, [
      sim('gen-retail-ceo-profitability', 'agreed'),
      sim('gen-retail-ceo-chain-visibility', 'agreed'),
      sim('gen-bank-teller-service-quality', 'agreed'),
    ])

    const runs = runsForRole(placed, 'retail', 'ceo', [
      { needKey: 'profitability' },
      { needKey: 'chain-visibility' },
    ])

    expect(runs).toHaveLength(2)
  })
})
