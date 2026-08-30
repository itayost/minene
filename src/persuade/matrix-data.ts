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
  const roleIds = new Set(roles.map((r) => r.id))

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
     * Runs with no role, or with a role that no longer exists, get a column
     * of their own.
     *
     * A sweep of the world space is deliberately tenant-free, and public.roles
     * is per-tenant, so those runs carry no role id and matched none of the
     * columns above -- they were being silently dropped from the grid. Seven of
     * eleven runs were invisible the first time this was looked at, which is
     * the worst way for a measurement screen to be wrong: it showed a smaller
     * number confidently rather than showing nothing.
     *
     * job_role_id is written once, when a run is saved, and roles-api.ts's
     * deleteRole is a hard delete with nothing that goes back and updates old
     * runs -- so a run recorded against a role that has since been deleted
     * carries an id that is neither null nor in the current catalogue, and
     * was falling through the same gap by a different door.
     *
     * Added only when such runs exist, so a tenant that always records a role
     * never sees an empty extra column.
     */
    const roleless = here.filter((s) => s.cell.jobRoleId === null || !roleIds.has(s.cell.jobRoleId))
    return roleless.length > 0
      ? [...columns, cell(industry, null, UNASSIGNED_ROLE, roleless)]
      : columns
  })
}

/** Named rather than blank, so the column says why it exists. */
export const UNASSIGNED_ROLE = 'ללא תפקיד'
