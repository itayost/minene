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
  // Two kinds of "no usable evidence", treated the same way.
  //
  // The first is a technique nothing has measured (`winPct === null`).
  //
  // The second is subtler and produces the more dangerous number: a category
  // the plan never offered is credited when the scorer names it as the winner,
  // but nothing records it having been reached for and FAILED, so it can only
  // ever enter its own denominator by winning (see TechniqueReport.offPlanWins).
  // Left in, a category with twenty such runs reads as 100% over a sample large
  // enough to clear `minRuns`, earns the ceiling weight, and is handed to a
  // person as the best-evidenced row in the table -- ahead of a technique with
  // four hundred honest runs. It is excluded from the proposals AND from the
  // peer baseline, because an impossible win rate distorts what "the peers did"
  // for everyone else too.
  const isArtefact = (r: TechniqueReport) => r.offPlanWins > r.runs / 2
  const rated = reports.filter((r) => r.winPct !== null && !isArtefact(r))
  if (rated.length === 0) return []

  // Pooled by runs, not one winPct per technique averaged flat: a technique
  // with a thousand runs and one with two must not count equally toward what
  // "the peers" did, or a lucky pair of runs sets the bar for reports built on
  // real evidence.
  const totalRuns = rated.reduce((sum, r) => sum + r.runs, 0)
  const totalWins = rated.reduce((sum, r) => sum + r.wins, 0)

  return rated.map((report) => {
    const win = report.winPct ?? 0
    // Relative to peers, not to a baseline the technique itself is pooled
    // into: a technique that ran most of the volume would otherwise be most
    // of its own "average", so a technique that is genuinely a third as good
    // as its one peer could read as merely below average instead of far
    // below it. Excluding the technique's own runs and wins is what keeps
    // "peers" meaning the others.
    const peerRuns = totalRuns - report.runs
    const peerWins = totalWins - report.wins
    const average = peerRuns === 0 ? 0 : (peerWins / peerRuns) * 100
    const ratio = average === 0 ? 1 : win / average
    const weight = Math.min(WEIGHT_CEILING, Math.max(WEIGHT_FLOOR, Number(ratio.toFixed(2))))

    const caveats: string[] = []
    if (report.runs < minRuns) caveats.push(`${report.runs} ריצות בלבד`)
    // `weight` is a ratio against the peer average, not against report.runs --
    // a technique can clear every other caveat here on its own volume and
    // still be rated off a peer group with almost nothing in it. The thinness
    // that matters for trusting the ratio is the peer group's, not this
    // technique's own.
    if (peerRuns < minRuns) caveats.push(`${peerRuns} ריצות בלבד אצל המתחרות`)

    // byReason only counts runs that carried a world -- a run with none has no
    // reason to key by, and sliceBy drops it. Comparing that total back to
    // report.runs is what tells "no world at all" apart from "some of them":
    // a technique's runs is one pooled number regardless, so a PARTIAL mix is
    // just as capable of moving it as a total one is -- see the pre-world vs.
    // world example in technique-report.ts that this same check exists to
    // catch there.
    const withReason = report.byReason.reduce((sum, s) => sum + s.runs, 0)
    const withoutWorld = report.runs - withReason
    if (withoutWorld === report.runs) {
      caveats.push('אין פילוח לפי סיבה — הריצות רצו בלי עולם')
    } else if (withoutWorld > 0) {
      caveats.push(`${withoutWorld} מתוך ${report.runs} ריצות בלי עולם — מעורבבות בשיעור הכולל`)
    }

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
