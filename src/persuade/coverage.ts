import { type CellIndex, cellKey, cellKeyOf, placeRun } from './cell'
import type { Run } from './engine/types'
import type { StoredSimulation } from './lib/simulations'
import type { MatrixCell } from './Matrix'
import type { TaxonomyIndustry } from './taxonomy'

/**
 * Runs, grouped onto the taxonomy.
 *
 * `unplaced` is load-bearing rather than diagnostic. Every run on record as of
 * 2026-09-22 carries the `briefings` plan, which predates the taxonomy and
 * belongs to no cell -- so a version of this that silently dropped what it
 * could not place would render an empty grid beside a total of 168 and give no
 * hint which of the two numbers to believe.
 */
export interface Placed {
  runsByCell: ReadonlyMap<string, Run[]>
  unplaced: number
}

/**
 * Whether a run belongs to the ordinary, deployed population.
 *
 * `queueExperiment` stamps an arm job with the same industry and plan an
 * ordinary sweep job would carry for that cell (`planExperiment` in
 * experiments.ts), and `runJob` writes the row under that cell's plan id, so
 * nothing about where a run lands tells an arm apart from a sweep run. An arm
 * runs under a `RuleConfig` nobody deployed -- it is a different population,
 * not more evidence about the same one. This is the same "pooling populations
 * that are not comparable" failure #43 and #48 already fixed for
 * technique-report.ts and the old matrix-data.ts; it was never carried into
 * this screen's taxonomy-driven rewrite (2026-09-22), which pools every row
 * `listSimulationSummaries` returns with no such check.
 *
 * `== null` rather than `=== null`: a `StoredSimulation` built directly
 * (a hand-started run, a test fixture) rather than read back through
 * `toStored` can leave the field `undefined` instead of `null`, and treating
 * that absence as "unknown, so exclude it" would be the same "0 where the
 * honest answer is null" mistake turned the other way -- silently emptying
 * every cell for anything that never round-tripped through the reader.
 * Absent means ordinary, exactly as `toStored`'s own `row.experiment ?? null`
 * already treats it.
 */
export function isComparable(sim: StoredSimulation): boolean {
  return sim.experiment == null
}

export function placeAll(index: CellIndex, sims: readonly StoredSimulation[]): Placed {
  const runsByCell = new Map<string, Run[]>()
  let unplaced = 0

  for (const sim of sims) {
    if (!isComparable(sim)) continue
    const cell = placeRun(index, sim.run.plan?.id)
    if (!cell) {
      unplaced += 1
      continue
    }
    const key = cellKey(cell)
    const existing = runsByCell.get(key)
    if (existing) existing.push(sim.run)
    else runsByCell.set(key, [sim.run])
  }

  return { runsByCell, unplaced }
}

/**
 * Null, never 0, when nothing has been run. "Nobody has tried this cell" and
 * "everybody refused here" are opposite facts; the second is a finding and the
 * first is an absence, and the heat scale renders them differently.
 */
export function coverageOf(runs: readonly Run[]): { runs: number; persuasionRate: number | null } {
  if (runs.length === 0) return { runs: 0, persuasionRate: null }
  const agreed = runs.filter((run) => run.state.outcome === 'agreed').length
  return { runs: runs.length, persuasionRate: Math.round((agreed / runs.length) * 100) }
}

export function runsForRole(
  placed: Placed,
  industry: string,
  roleSlug: string,
  needs: readonly { needKey: string }[],
): Run[] {
  return needs.flatMap(
    (need) => placed.runsByCell.get(cellKeyOf(industry, roleSlug, need.needKey)) ?? [],
  )
}

/**
 * Every industry and every role in the taxonomy, whether or not a run exists.
 *
 * This is the reversal the whole screen turns on. matrixFrom built its rows
 * from the runs, which answers "what have we measured"; this builds them from
 * the catalogue, which answers "where has the sweep been". For an instrument,
 * the second question is the one worth a screen.
 */
export function gridFrom(taxonomy: readonly TaxonomyIndustry[], placed: Placed): MatrixCell[] {
  return taxonomy.flatMap((industry) =>
    industry.roles.map((role) => ({
      industry: industry.industry,
      industryLabel: industry.label,
      roleSlug: role.roleSlug,
      roleLabel: role.roleLabel,
      ...coverageOf(runsForRole(placed, industry.industry, role.roleSlug, role.needs)),
    })),
  )
}
