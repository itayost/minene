'use client'

export type MatrixCell = {
  industry: string
  /** Hebrew. The industry is a bare slug in the database with no label column. */
  industryLabel: string
  /**
   * From role_needs, not from public.roles. The per-tenant catalogue was the
   * wrong vocabulary for a sweep that is deliberately tenant-free, which is how
   * 164 of 168 runs ended up in a column labelled "no role".
   */
  roleSlug: string
  roleLabel: string
  runs: number
  /**
   * Null when nothing has been run here. Never 0: "nobody has tried this cell"
   * and "everybody refused here" are opposite facts, and the second is a
   * finding while the first is an absence.
   */
  persuasionRate: number | null
  /**
   * Set when the cell pools runs from more than one recorded persuader model.
   * A model upgrade mid-history can make two incomparable populations read as
   * one clean rate -- the same confound effectiveness.ts's technique report
   * and experiment-results.ts's arm comparison already warn about.
   */
  modelsMixed?: boolean
}

/**
 * Five steps, one hue, light to dark. Persuasion rate is a magnitude, so the
 * scale is sequential -- never diverging, which would imply a meaningful
 * midpoint, and never a rainbow, which implies an order the hues do not have.
 *
 * The step boundaries are even fifths. The label colour per step is computed
 * against the fill rather than chosen: steps 1-3 carry --text, 4-5 carry white,
 * and the obvious step 4 (the brand's own #B76578) had to be darkened to
 * #A35468 because it reaches only 4.08:1 against white and fails at body size.
 */
function heatStep(rate: number): 1 | 2 | 3 | 4 | 5 {
  if (rate < 20) return 1
  if (rate < 40) return 2
  if (rate < 60) return 3
  if (rate < 80) return 4
  return 5
}

const cellKey = (cell: MatrixCell) => `${cell.industry}::${cell.roleSlug}`

export function Matrix({
  cells,
  selected,
  onSelect,
}: {
  cells: readonly MatrixCell[]
  selected: MatrixCell | null
  onSelect: (cell: MatrixCell) => void
}) {
  const industries = [...new Map(cells.map((c) => [c.industry, c.industryLabel])).entries()]
  const roles = [...new Map(cells.map((c) => [c.roleSlug, c.roleLabel])).entries()]
  const byKey = new Map(cells.map((c) => [cellKey(c), c]))

  return (
    <div className="matrix-scroll">
      <table aria-label="שיעור שכנוע לפי ענף ותפקיד" className="matrix" role="grid">
        <thead>
          <tr>
            <th />
            {roles.map(([slug, label]) => (
              <th key={slug} scope="col">
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {industries.map(([industry, label]) => (
            <tr key={industry}>
              <th scope="row">{label}</th>
              {roles.map(([slug, roleLabel]) => {
                const cell = byKey.get(`${industry}::${slug}`)
                if (!cell) {
                  // Structurally absent, not merely unrun: roles are an
                  // industry-specific vocabulary (only 21 of the 5*26 = 130
                  // (industry, role) combinations the cross-product implies
                  // are real), so this combination can never have a run. Its
                  // own token keeps it from being read as "no runs here",
                  // which is what data-heat="none" means on this screen.
                  return (
                    <td
                      aria-label={`${label}, ${roleLabel}, התפקיד הזה לא קיים בענף הזה`}
                      className="cell"
                      data-heat="absent"
                      key={slug}
                      role="gridcell"
                      // Programmatically focusable (satisfies the grid role's
                      // own a11y requirement) without joining the Tab order --
                      // unlike the real cells beside it, there is nothing here
                      // to act on.
                      tabIndex={-1}
                    />
                  )
                }

                const measured = cell.persuasionRate !== null
                const mixedNote = cell.modelsMixed ? ', כולל ריצות מיותר מצירוף מודלים אחד' : ''
                return (
                  <td
                    // The row and column headers are out of reach for a screen
                    // reader moving cell to cell, so the cell says where it is.
                    aria-label={
                      measured
                        ? `${cell.industryLabel}, ${cell.roleLabel}, ${cell.persuasionRate} אחוז, ${cell.runs} ריצות${mixedNote}`
                        : `${cell.industryLabel}, ${cell.roleLabel}, אין ריצות`
                    }
                    aria-selected={selected ? cellKey(selected) === cellKey(cell) : undefined}
                    className="cell"
                    data-heat={measured ? heatStep(cell.persuasionRate as number) : 'none'}
                    data-models-mixed={cell.modelsMixed ? 'true' : undefined}
                    key={slug}
                    onClick={() => onSelect(cell)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') onSelect(cell)
                    }}
                    role="gridcell"
                    tabIndex={0}
                  >
                    <b>{measured ? `${cell.persuasionRate}%` : '—'}</b>
                    <span>
                      {measured ? `${cell.runs} ריצות` : 'אין ריצות'}
                      {cell.modelsMixed ? ' *' : ''}
                    </span>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
