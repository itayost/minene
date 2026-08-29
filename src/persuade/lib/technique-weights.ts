import type { SupabaseClient } from '@supabase/supabase-js'
import type { TechniqueReport } from '../effectiveness'
import type { ArgumentCategory } from '../engine/types'
import type { Reason } from '../engine/world'

/**
 * The gate between what the lab found and what the bot believes.
 *
 * The architecture this came from draws one arrow from its Learning Engine
 * straight back into the rules database. That arrow is where its own closing
 * caveat -- "otherwise the system will simply learn how to persuade the LLM
 * playing an employee" -- stops being a caveat and becomes the design.
 *
 * So there is no arrow. `propose` turns evidence into a suggestion and writes
 * nothing. `readPromoted` returns only rows a person accepted. Nothing in this
 * file promotes, and there is deliberately no function that could be called on
 * a schedule to do it.
 */

export interface TechniqueWeight {
  industry: string
  jobRoleName: string | null
  reason: Reason | null
  category: ArgumentCategory
  weight: number
}

export interface WeightProposal extends TechniqueWeight {
  /** What the suggestion is based on, carried so a promotion can record it. */
  evidence: { runs: number; winPct: number | null; negativeReactionPct: number | null }
  /** Why this is only a suggestion, when it is a weak one. */
  caveat: string | null
}

const WEIGHT_FLOOR = 0
const WEIGHT_CEILING = 3

/**
 * Evidence in, suggestions out. Writes nothing, by design.
 *
 * The mapping is deliberately dull: a technique that wins more than the average
 * of its peers is nudged up, one that wins less is nudged down, and the nudge is
 * capped. A cleverer curve would imply a precision the underlying number does
 * not have -- see the caveat on TechniqueReport.runs about what the denominator
 * actually counts.
 */
export function propose(
  reports: readonly TechniqueReport[],
  options: {
    industry?: string
    jobRoleName?: string | null
    reason?: Reason | null
    minRuns?: number
  } = {},
): WeightProposal[] {
  const minRuns = options.minRuns ?? 10
  const rated = reports.filter((r) => r.winPct !== null)
  if (rated.length === 0) return []

  const average = rated.reduce((sum, r) => sum + (r.winPct ?? 0), 0) / rated.length

  return rated.map((report) => {
    const win = report.winPct ?? 0
    // Relative to peers, not absolute: a 20% win rate is good in a hard cell
    // and poor in an easy one, and only the comparison survives that.
    const ratio = average === 0 ? 1 : win / average
    const weight = Math.min(WEIGHT_CEILING, Math.max(WEIGHT_FLOOR, Number(ratio.toFixed(2))))

    const caveats: string[] = []
    if (report.runs < minRuns) caveats.push(`${report.runs} ריצות בלבד`)
    if (report.byReason.length === 0) caveats.push('אין פילוח לפי סיבה — הריצות רצו בלי עולם')
    if ((report.negativeReactionPct ?? 0) >= 30) {
      caveats.push(`${report.negativeReactionPct}% מהשיחות הסתיימו בעייפות`)
    }

    return {
      industry: options.industry ?? 'retail',
      jobRoleName: options.jobRoleName ?? null,
      reason: options.reason ?? null,
      category: report.category,
      weight,
      evidence: {
        runs: report.runs,
        winPct: report.winPct,
        negativeReactionPct: report.negativeReactionPct,
      },
      caveat: caveats.length > 0 ? caveats.join(' · ') : null,
    }
  })
}

interface WeightRow {
  industry: string
  job_role_name: string | null
  reason: Reason | null
  category: ArgumentCategory
  weight: number
}

/**
 * What production is allowed to consult.
 *
 * Filtered on `promoted_at is not null`, which is the gate itself. A row
 * written as a proposal and never accepted is invisible here -- so the failure
 * mode of somebody inserting suggestions in bulk is that nothing happens, not
 * that the bot quietly changes what it says to people.
 */
export async function readPromoted(
  client: SupabaseClient,
  cell: { industry: string; jobRoleName?: string | null; reason?: Reason | null },
): Promise<TechniqueWeight[]> {
  const query = client
    .from('technique_weights')
    .select('industry,job_role_name,reason,category,weight')
    .not('promoted_at', 'is', null)
    .eq('industry', cell.industry)

  const { data, error } = await query
  if (error) throw new Error(`קריאת המשקלים נכשלה: ${error.message}`)

  const rows = (data ?? []) as WeightRow[]
  return (
    rows
      // A null reason or role on the row means "applies to every one of them",
      // which is how a general finding is stated without a row per combination.
      .filter((r) => r.reason === null || r.reason === (cell.reason ?? null))
      .filter((r) => r.job_role_name === null || r.job_role_name === (cell.jobRoleName ?? null))
      .map((r) => ({
        industry: r.industry,
        jobRoleName: r.job_role_name,
        reason: r.reason,
        category: r.category,
        weight: r.weight,
      }))
  )
}

/**
 * Records a decision a person made. The only way a weight becomes live.
 *
 * `promotedBy` is required rather than optional: a weight with nobody's name on
 * it is a number that changed itself, and the whole point of this table is that
 * such a number cannot exist.
 */
export async function promote(
  client: SupabaseClient,
  proposal: WeightProposal,
  promotedBy: string,
  note?: string,
): Promise<void> {
  const { error } = await client.from('technique_weights').upsert(
    {
      industry: proposal.industry,
      job_role_name: proposal.jobRoleName,
      reason: proposal.reason,
      category: proposal.category,
      weight: proposal.weight,
      promoted_by: promotedBy,
      promoted_at: new Date().toISOString(),
      evidence: proposal.evidence,
      note: note ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'industry,job_role_name,reason,category' },
  )
  if (error) throw new Error(`קידום המשקל נכשל: ${error.message}`)
}
