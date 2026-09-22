import { industryLabel, type RoleNeed } from './cell'

/**
 * The structure the screen is drawn from: industry, role, need.
 *
 * Read from role_needs rather than from the runs, which is the one decision
 * this whole screen turns on. matrixFrom derived its industries from the
 * simulations, so a sector nobody had run did not exist on screen. That answers
 * "what have we measured"; this screen answers "where has the sweep been", and
 * for that question the hole is the finding.
 */

export interface NeedRow extends RoleNeed {
  needOrder: number
}

export interface TaxonomyNeed {
  needKey: string
  needLabel: string
  metaNeed: string
}

export interface TaxonomyRole {
  roleSlug: string
  roleLabel: string
  needs: TaxonomyNeed[]
}

export interface TaxonomyIndustry {
  industry: string
  label: string
  roles: TaxonomyRole[]
}

/**
 * Ordered by role_order and need_order, never by label. The order is the org
 * chart and the priority list, both of which the labels would scramble.
 */
export function taxonomyFrom(rows: readonly NeedRow[]): TaxonomyIndustry[] {
  const industries = new Map<string, Map<string, { role: NeedRow; needs: NeedRow[] }>>()

  for (const row of rows) {
    const roles = industries.get(row.industry) ?? new Map()
    industries.set(row.industry, roles)
    const entry = roles.get(row.roleSlug) ?? { role: row, needs: [] }
    entry.needs.push(row)
    roles.set(row.roleSlug, entry)
  }

  return [...industries.entries()]
    .map(([industry, roles]) => ({
      industry,
      label: industryLabel(industry),
      roles: [...roles.values()]
        .sort((a, b) => a.role.roleOrder - b.role.roleOrder)
        .map(({ role, needs }) => ({
          roleSlug: role.roleSlug,
          roleLabel: role.roleLabel,
          needs: [...needs]
            .sort((a, b) => a.needOrder - b.needOrder)
            .map((need) => ({
              needKey: need.needKey,
              needLabel: need.needLabel,
              metaNeed: need.metaNeed,
            })),
        })),
    }))
    .sort((a, b) => a.industry.localeCompare(b.industry))
}
