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
     * Runs with no role get a column of their own.
     *
     * A sweep of the world space is deliberately tenant-free, and public.roles
     * is per-tenant, so those runs carry no role id and matched none of the
     * columns above -- they were being silently dropped from the grid. Seven of
     * eleven runs were invisible the first time this was looked at, which is
     * the worst way for a measurement screen to be wrong: it showed a smaller
     * number confidently rather than showing nothing.
     *
     * Added only when such runs exist, so a tenant that always records a role
     * never sees an empty extra column.
     */
    const roleless = here.filter((s) => s.cell.jobRoleId === null)
    const rolelessColumn =
      roleless.length > 0 ? [cell(industry, null, UNASSIGNED_ROLE, roleless)] : []

    /**
     * A run whose jobRoleId is set but names no role in the current catalogue --
     * typically because the role was deleted (RolesManager) after the run was
     * recorded. Same failure as the roleless case above: it matches no column
     * built from `roles` and isn't the null-id case either, so it was being
     * silently dropped from the grid. The id is kept (unlike the roleless
     * bucket) so a cell picked here still maps back to the exact runs that
     * produced it.
     */
    const orphanIds = [
      ...new Set(
        here
          .filter((s) => s.cell.jobRoleId !== null && !knownRoleIds.has(s.cell.jobRoleId))
          .map((s) => s.cell.jobRoleId as string),
      ),
    ]
    const orphanColumns = orphanIds.map((id) =>
      cell(
        industry,
        id,
        DELETED_ROLE,
        here.filter((s) => s.cell.jobRoleId === id),
      ),
    )

    return [...columns, ...rolelessColumn, ...orphanColumns]
  })
}

/** Named rather than blank, so the column says why it exists. */
export const UNASSIGNED_ROLE = 'ללא תפקיד'

/** For a jobRoleId that no role in the current catalogue matches -- the role was deleted. */
export const DELETED_ROLE = 'תפקיד שנמחק'
