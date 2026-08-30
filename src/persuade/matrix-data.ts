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
  const knownRoleIds = new Set(roles.map((role) => role.id))

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
     * Runs with no role, or with a role id the catalogue no longer has, get a
     * column of their own.
     *
     * A sweep of the world space is deliberately tenant-free, and public.roles
     * is per-tenant, so those runs carry no role id and matched none of the
     * columns above -- they were being silently dropped from the grid. Seven of
     * eleven runs were invisible the first time this was looked at, which is
     * the worst way for a measurement screen to be wrong: it showed a smaller
     * number confidently rather than showing nothing.
     *
     * The same disappearance happens to a run whose role id is not null but is
     * no longer in `roles` -- a renamed or deleted role, or a role belonging to
     * a different tenant's catalogue. `columns` only has a cell per id `roles`
     * still lists, so that run matches none of them either, and unlike the null
     * case it used to match the roleless bucket's `=== null` check even less:
     * it vanished from the total without a column to blame it on. A run counts
     * as roleless here whenever its id is not one `roles` actually has.
     *
     * Added only when such runs exist, so a tenant that always records a live
     * role never sees an empty extra column.
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
