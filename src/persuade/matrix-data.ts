import type { StoredSimulation } from './lib/simulations'
import type { MatrixCell } from './Matrix'

/**
 * How many distinct RECORDED persuader-model fingerprints a set of runs
 * carries.
 *
 * Mirrors `distinctModelFingerprints` in `effectiveness.ts` exactly, and for
 * the same reason: the matrix pools runs into a persuasion rate the same
 * uncontrolled way a technique report pools them into a win rate, so a
 * persuader-model swap mid-history would blend two model generations into one
 * cell with nothing on screen to say so. A row with nothing recorded is an
 * unknown, not a second model -- counting it would flag every cell that spans
 * the day `models` started being recorded, forever.
 */
function distinctModelFingerprints(simulations: readonly StoredSimulation[]): number {
  return new Set(simulations.filter((s) => s.models).map((s) => JSON.stringify(s.models))).size
}

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
  const knownRoleIds = new Set(roles.map((r) => r.id))

  const cell = (
    industry: string,
    jobRoleId: string | null,
    jobRoleName: string,
    inCell: readonly StoredSimulation[],
  ): MatrixCell => {
    const agreed = inCell.filter((s) => s.run.state.outcome === 'agreed').length
    return {
      industry,
      jobRoleId,
      jobRoleName,
      runs: inCell.length,
      // Null, never 0, when nothing has been run here. The heat scale reads
      // null as "no fill at all" rather than as the palest measured value.
      persuasionRate: inCell.length === 0 ? null : Math.round((agreed / inCell.length) * 100),
      // Confirmed rather than suspected: only fires once the cell holds two
      // runs with DIFFERENT recorded fingerprints, never merely because some
      // runs predate the column.
      modelsMixed: distinctModelFingerprints(inCell) > 1,
    }
  }

  return industries.flatMap((industry) => {
    const here = simulations.filter((s) => s.cell.industry === industry)
    const columns = roles.map((role) =>
      cell(
        industry,
        role.id,
        role.name,
        here.filter((s) => s.cell.jobRoleId === role.id),
      ),
    )

    /**
     * Runs with no role, or with one the current catalogue no longer answers
     * to, get a column of their own rather than vanishing.
     *
     * A sweep of the world space is deliberately tenant-free, and public.roles
     * is per-tenant, so those runs carry no role id and matched none of the
     * columns above -- they were being silently dropped from the grid. Seven of
     * eleven runs were invisible the first time this was looked at, which is
     * the worst way for a measurement screen to be wrong: it showed a smaller
     * number confidently rather than showing nothing.
     *
     * A role id that IS set can go stale the same way: roles are hard-deleted
     * (see roles-api.ts's deleteRole), so a run queued against a role that has
     * since been removed or renamed carries an id none of today's columns
     * match either -- the same join failure, just not null this time.
     *
     * Added only when such runs exist, so a tenant that always records a role
     * never sees an empty extra column.
     */
    const roleless = here.filter(
      (s) => s.cell.jobRoleId === null || !knownRoleIds.has(s.cell.jobRoleId),
    )
    return roleless.length > 0
      ? [...columns, cell(industry, null, UNASSIGNED_ROLE, roleless)]
      : columns
  })
}

/** Named rather than blank, so the column says why it exists. */
export const UNASSIGNED_ROLE = 'ללא תפקיד'
