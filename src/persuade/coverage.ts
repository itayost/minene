import { type CellIndex, cellKey, cellKeyOf, placeRun } from './cell'
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
  runsByCell: ReadonlyMap<string, StoredSimulation[]>
  unplaced: number
}

export function placeAll(index: CellIndex, sims: readonly StoredSimulation[]): Placed {
  const runsByCell = new Map<string, StoredSimulation[]>()
  let unplaced = 0

  for (const sim of sims) {
    const cell = placeRun(index, sim.run.plan?.id)
    if (!cell) {
      unplaced += 1
      continue
    }
    const key = cellKey(cell)
    const existing = runsByCell.get(key)
    if (existing) existing.push(sim)
    else runsByCell.set(key, [sim])
  }

  return { runsByCell, unplaced }
}

/**
 * How many distinct persuader-model fingerprints a cell's runs carry.
 *
 * Mirrors effectiveness.ts's distinctModelFingerprints and
 * experiment-results.ts's readiness(): a run with nothing recorded is an
 * unknown, not a second model, so it is never counted -- otherwise every cell
 * spanning the day `models` started being written would read as mixed on no
 * evidence at all.
 */
function distinctModelFingerprints(sims: readonly StoredSimulation[]): number {
  return new Set(sims.filter((s) => s.models).map((s) => JSON.stringify(s.models))).size
}

/**
 * Null, never 0, when nothing has been run. "Nobody has tried this cell" and
 * "everybody refused here" are opposite facts; the second is a finding and the
 * first is an absence, and the heat scale renders them differently.
 *
 * `modelsMixed` is the same guard this lab's other reports already carry for a
 * technique's win rate (effectiveness.ts) and an experiment's arm comparison
 * (experiment-results.ts): a cell pools whatever runs land in it with no
 * regard for which persuader model produced them, so a model upgrade
 * mid-history can make two incomparable populations read as one clean rate.
 */
export function coverageOf(sims: readonly StoredSimulation[]): {
  runs: number
  persuasionRate: number | null
  modelsMixed: boolean
} {
  if (sims.length === 0) return { runs: 0, persuasionRate: null, modelsMixed: false }
  const agreed = sims.filter((s) => s.run.state.outcome === 'agreed').length
  return {
    runs: sims.length,
    persuasionRate: Math.round((agreed / sims.length) * 100),
    modelsMixed: distinctModelFingerprints(sims) > 1,
  }
}

export function runsForRole(
  placed: Placed,
  industry: string,
  roleSlug: string,
  needs: readonly { needKey: string }[],
): StoredSimulation[] {
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
