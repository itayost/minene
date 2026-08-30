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

  const knownRoleIds = new Set(roles.map((r) => r.id))

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
     * Runs with no matching role get a column of their own.
     *
     * Two ways a run ends up here, both invisible to a naive join. A sweep of
     * the world space is deliberately tenant-free, and public.roles is
     * per-tenant, so those runs carry no role id at all. And because
     * simulations are shared across every tenant while `roles` is scoped to
     * the caller's own, a run recorded under another tenant's role id matches
     * no id in *this* `roles` list either -- it is not null, so the first
     * fix for the null case alone let it keep matching no column and
     * disappearing. Both were silently dropped from the grid before this
     * caught the id as well as the null: seven of eleven runs were invisible
     * the first time this was looked at, which is the worst way for a
     * measurement screen to be wrong -- it showed a smaller number
     * confidently rather than showing nothing.
     *
     * Added only when such runs exist, so a tenant that always records a
     * known role never sees an empty extra column.
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
