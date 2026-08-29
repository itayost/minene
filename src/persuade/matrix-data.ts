import type { StoredSimulation } from './lib/simulations'
import type { MatrixCell } from './Matrix'

/**
 * Turns runs into the grid.
 *
 * The rows come from the data and the columns from the role catalogue, which is
 * deliberately asymmetric: a sector nobody has run does not belong on screen at
 * all, while a role nobody has run in a sector they HAVE is a real gap worth
 * showing. The first would be hatching that says nothing; the second says
 * "here is a question nobody has asked yet".
 */
export function matrixFrom(
  simulations: readonly StoredSimulation[],
  roles: readonly { id: string; name: string }[],
): MatrixCell[] {
  const industries = [...new Set(simulations.map((s) => s.cell.industry))].sort()

  return industries.flatMap((industry) =>
    roles.map((role) => {
      const inCell = simulations.filter(
        (s) => s.cell.industry === industry && s.cell.jobRoleId === role.id,
      )
      const agreed = inCell.filter((s) => s.run.state.outcome === 'agreed').length

      return {
        industry,
        jobRoleId: role.id,
        jobRoleName: role.name,
        runs: inCell.length,
        // Null, never 0, when nothing has been run here. The heat scale reads
        // null as "no fill at all" rather than as the palest measured value.
        persuasionRate: inCell.length === 0 ? null : Math.round((agreed / inCell.length) * 100),
      }
    }),
  )
}
