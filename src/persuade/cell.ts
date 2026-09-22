/**
 * Where a run belongs in the taxonomy, resolved by exact lookup.
 *
 * The three axes the brief filters on -- industry, role, need -- are encoded in
 * the plan key and nowhere else that can be trusted: `simulations.job_role_id`
 * is null on 164 of 168 rows because the sweep is deliberately tenant-free, and
 * `simulations.need` held the world's reason rather than a need until Task 3.
 *
 * Resolution is a map lookup rather than a parse. Role slugs and need keys both
 * match `^[a-z0-9-]+$`, so `gen-retail-area-manager-food-waste` splits two ways
 * and a parser has to guess. Building the map with the same `planKeyFor` the
 * generator writes keys with removes the guess entirely.
 */

export interface RoleRef {
  industry: string
  roleSlug: string
  roleLabel: string
  roleOrder: number
}

export interface RoleNeed extends RoleRef {
  needKey: string
  needLabel: string
  metaNeed: string
}

export const planKeyFor = (need: { industry: string; roleSlug: string; needKey: string }): string =>
  `gen-${need.industry}-${need.roleSlug}-${need.needKey}`

/** `null` under a key means two or more needs claim it -- see below. */
export type CellIndex = ReadonlyMap<string, RoleNeed | null>

/**
 * A collided key resolves to null, never to a winner. `planKeyFor` joins
 * three hyphen-bearing segments with hyphens, so two distinct (industry,
 * roleSlug, needKey) tuples can format to the identical string -- see
 * cell.test.ts's "refuses to place a run whose key two cells both claim".
 * Picking either need for that key would be a guess dressed up as a lookup,
 * and inventing a cell is the one thing this index exists to rule out. A run
 * whose key is ambiguous is treated exactly like one whose key is unknown:
 * it falls to `placeRun`'s null, and stays visible in the unplaced bucket
 * rather than being attributed to whichever need happened to register first.
 * role_needs has no such collision today (130 rows, 130 distinct keys); this
 * is a guard against a future one, not a repair for a present one.
 */
export function cellIndex(needs: readonly RoleNeed[]): CellIndex {
  const index = new Map<string, RoleNeed | null>()
  for (const need of needs) {
    const key = planKeyFor(need)
    index.set(key, index.has(key) ? null : need)
  }
  return index
}

/**
 * Null is a real answer, not a failure. `briefings` is a plan that predates the
 * taxonomy, and every run on record carries it. Callers count these rather than
 * dropping them: a measurement screen that quietly loses runs has been wrong
 * here before.
 */
export function placeRun(index: CellIndex, planId: string | null | undefined): RoleNeed | null {
  if (!planId) return null
  return index.get(planId) ?? null
}

/**
 * The one spelling of a cell's key. Exported beside `cellKey` because the
 * readers hold three loose strings (the URL's industry, role and need) rather
 * than a RoleNeed, and three hand-written copies of this template is three
 * places to forget when the separator changes.
 */
export const cellKeyOf = (industry: string, roleSlug: string, needKey: string): string =>
  `${industry}/${roleSlug}/${needKey}`

export const cellKey = (cell: RoleNeed): string =>
  cellKeyOf(cell.industry, cell.roleSlug, cell.needKey)

/**
 * The only Hebrew an industry has. role_needs carries role_label and
 * need_label, but the industry is a bare slug constrained by a check
 * constraint, so there is nowhere in the database to read this from.
 */
export const INDUSTRY_LABELS: Record<string, string> = {
  retail: 'קמעונאות',
  bank: 'בנקאות',
  healthcare: 'בריאות',
  restaurants: 'מסעדנות',
  infrastructure: 'תשתיות',
}

/** An unlisted key passes through as-is rather than rendering as blank. */
export const industryLabel = (industry: string): string => INDUSTRY_LABELS[industry] ?? industry
