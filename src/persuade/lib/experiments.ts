import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RULES, type RuleConfig } from '../engine/rules'
import { buildWorld, type WorldCell, type WorldState, worldCells } from '../engine/world'

/**
 * Experiments over the engine's own settings.
 *
 * The lab can answer one question well: does changing a rule make the persuader
 * better. `RuleConfig` is already a per-run parameter -- word limits, rung
 * pacing, interaction count, fatigue threshold -- so the machinery is a queue
 * and a comparison rather than an engine change.
 *
 * The only hard part is making the comparison mean anything, and it is the part
 * that is easy to get wrong: a batch where the plan, the persona and the config
 * all differ measures nothing at all. So an experiment is a PAIRED design. It
 * names a set of (persona, plan) pairs, and every arm runs against every pair.
 * Two arms then differ by exactly the config, and the difference in their
 * outcomes is attributable to it.
 *
 * This is also why `variants` takes a full RuleConfig per arm rather than a
 * patch: an arm you cannot read in one place is an arm nobody can tell you the
 * shape of afterwards.
 */

export interface ExperimentArm {
  /** Stable, lowercase-hyphen. It is what the comparison groups by. */
  variant: string
  rules: RuleConfig
}

export interface ExperimentSpec {
  experiment: string
  /** Held fixed across arms, so the config is the only thing that differs. */
  world?: WorldState | null
  arms: ExperimentArm[]
  /** Every arm runs against every one of these. */
  pairs: { personaKey: string; planKey: string }[]
  industry?: string
  segment?: string | null
  jobRoleId?: string | null
  need?: string | null
  /** How many times each (arm, pair) combination runs. */
  repeats?: number
}

export interface QueuedJob {
  experiment: string | null
  variant: string | null
  persona_key: string
  plan_key: string
  industry: string
  /** The finer label under the industry. Free text; the industry is the key. */
  segment: string | null
  job_role_id: string | null
  need: string | null
  rules: RuleConfig
  world: WorldState | null
}

/**
 * The cross product, as rows.
 *
 * Split out from the write so it can be tested without a database: the
 * pairing is the part with a claim in it, and the insert is not.
 */
export function planExperiment(spec: ExperimentSpec): QueuedJob[] {
  const repeats = Math.max(1, spec.repeats ?? 1)
  const jobs: QueuedJob[] = []

  for (const arm of spec.arms) {
    for (const pair of spec.pairs) {
      for (let i = 0; i < repeats; i += 1) {
        jobs.push({
          experiment: spec.experiment,
          variant: arm.variant,
          persona_key: pair.personaKey,
          plan_key: pair.planKey,
          industry: spec.industry ?? 'retail',
          segment: spec.segment ?? null,
          job_role_id: spec.jobRoleId ?? null,
          need: spec.need ?? null,
          rules: arm.rules,
          // An experiment holds the world fixed so the setting is the only
          // thing that varies. Scenario coverage is a different job, below.
          world: spec.world ?? null,
        })
      }
    }
  }
  return jobs
}

/**
 * Rejects an experiment that could not answer anything, before it is queued.
 *
 * Every one of these has cost eleven model calls a run to discover afterwards,
 * which is the reason to check first rather than to notice in the comparison.
 */
export function validateExperiment(spec: ExperimentSpec): string[] {
  const problems: string[] = []

  if (spec.arms.length < 2) problems.push('צריך לפחות שתי זרועות כדי להשוות')
  if (spec.pairs.length === 0) problems.push('צריך לפחות צמד אחד של דמות ותוכנית')

  const variants = spec.arms.map((a) => a.variant)
  if (new Set(variants).size !== variants.length) problems.push('יש שמות זרוע כפולים')

  // Two arms with identical settings are the same arm twice: the comparison
  // would report a difference that is pure noise, and read as a finding.
  const shapes = spec.arms.map((a) => JSON.stringify(a.rules))
  if (new Set(shapes).size !== shapes.length) {
    problems.push('שתי זרועות עם אותן הגדרות בדיוק — אין מה להשוות')
  }

  // One axis at a time. Two arms differing in three settings tell you the three
  // together did something, and nothing about which. Checked over every pair,
  // not just arms[0] against arms[1] -- a third arm is still a confound if it
  // differs from either of the others in more than one setting.
  const keys = Object.keys(DEFAULT_RULES) as (keyof RuleConfig)[]
  for (let i = 0; i < spec.arms.length; i += 1) {
    for (let j = i + 1; j < spec.arms.length; j += 1) {
      const a = spec.arms[i] as ExperimentArm
      const b = spec.arms[j] as ExperimentArm
      const differing = keys.filter((key) => a.rules[key] !== b.rules[key])
      if (differing.length > 1) {
        problems.push(
          `${a.variant} ו-${b.variant} נבדלות ביותר מהגדרה אחת (${differing.join(', ')}) — לא יהיה אפשר לדעת מה גרם למה`,
        )
      }
    }
  }

  return problems
}

/** Queues an experiment. Returns how many jobs were written. */
export async function queueExperiment(
  client: SupabaseClient,
  spec: ExperimentSpec,
): Promise<number> {
  const problems = validateExperiment(spec)
  if (problems.length > 0) throw new Error(problems.join(' · '))

  const jobs = planExperiment(spec)
  const { error } = await client.from('simulation_jobs').insert(jobs)
  if (error) throw new Error(`הוספת עבודות נכשלה: ${error.message}`)
  return jobs.length
}

/**
 * A ready-made experiment over the setting the field report was about.
 *
 * Eran's note was that the answers were too long. The limits came down from
 * 45 words to 25 on that basis, which was a judgement call made from one
 * person's reading -- this is how it stops being one.
 */
export function messageLengthExperiment(pairs: ExperimentSpec['pairs']): ExperimentSpec {
  return {
    experiment: 'message-length',
    pairs,
    repeats: 3,
    arms: [
      { variant: 'short-25', rules: { ...DEFAULT_RULES, maxWordsPerMessage: 25 } },
      { variant: 'long-45', rules: { ...DEFAULT_RULES, maxWordsPerMessage: 45 } },
    ],
  }
}

/**
 * Queue a sweep across the world space rather than an experiment.
 *
 * The other half of the loop, and the one that makes it worth running
 * continuously. An experiment varies one setting and holds the world still; a
 * sweep holds the settings still and walks the worlds -- which is what fills in
 * "this technique works on someone who forgot and not on someone who
 * disagrees".
 *
 * Cells are taken in order rather than sampled, and `after` resumes where the
 * last sweep stopped. Random sampling would re-run the same easy cells and
 * leave holes nobody could name; walking the enumeration means coverage is a
 * fact you can state.
 */
export interface SweepSpec {
  personaKeys: string[]
  planKeys: string[]
  rules?: RuleConfig
  industry?: string
  segment?: string | null
  jobRoleId?: string | null
  /** How many world cells to take this time. */
  cells?: number
  /** Resume point: how many cells earlier sweeps already covered. */
  after?: number
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

/**
 * The golden-ratio step for a space of n cells, adjusted to be coprime with n.
 *
 * Coprimality is the load-bearing part: without it the walk revisits a subset
 * and never reaches the rest, so `planSweep` would silently stop covering the
 * space. Searches outward from the ideal so the result stays as close to it as
 * coprimality allows.
 */
export function goldenStride(n: number): number {
  if (n <= 2) return 1
  const ideal = Math.round(n / ((1 + Math.sqrt(5)) / 2))
  for (let delta = 0; delta < n; delta += 1) {
    for (const candidate of [ideal - delta, ideal + delta]) {
      if (candidate > 0 && candidate < n && gcd(candidate, n) === 1) return candidate
    }
  }
  return 1
}

export function planSweep(spec: SweepSpec): QueuedJob[] {
  const all = worldCells()
  const start = Math.max(0, spec.after ?? 0)
  const take = Math.min(Math.max(1, spec.cells ?? 10), all.length)

  /**
   * Strided, not contiguous, and the stride is derived rather than chosen.
   *
   * worldCells() nests the axes, so consecutive cells differ only in the
   * innermost one -- the first ten are ten variations of a single situation. A
   * short contiguous sweep would run near-duplicates and call it coverage.
   *
   * The stride is the golden-ratio step, round(n / phi), nudged to the nearest
   * value coprime with n. Coprime means every cell is still visited exactly
   * once before any repeats, so `after` resumes correctly and full coverage is
   * unaffected; the golden ratio is the classic low-discrepancy choice, so any
   * short run of it spreads across all axes rather than marching down one.
   *
   * Derived because it was hardcoded once and broke silently. 37 was tuned for
   * 162 cells; adding one axis made it 324 and eight picks collapsed to two
   * distinct reasons. The brief says more axes are coming, so a constant here
   * is a constant that will be wrong again.
   */
  const stride = goldenStride(all.length)
  const chosen: WorldCell[] = []
  for (let i = 0; i < take; i += 1) {
    chosen.push(all[((start + i) * stride) % all.length] as WorldCell)
  }

  const jobs: QueuedJob[] = []
  for (const cell of chosen) {
    for (const personaKey of spec.personaKeys) {
      for (const planKey of spec.planKeys) {
        jobs.push({
          experiment: null,
          variant: null,
          persona_key: personaKey,
          plan_key: planKey,
          industry: spec.industry ?? 'retail',
          segment: spec.segment ?? null,
          job_role_id: spec.jobRoleId ?? null,
          need: cell.reason,
          rules: spec.rules ?? DEFAULT_RULES,
          world: buildWorld(cell),
        })
      }
    }
  }
  return jobs
}

/** Queues a sweep. Returns how many jobs were written. */
export async function queueSweep(client: SupabaseClient, spec: SweepSpec): Promise<number> {
  if (spec.personaKeys.length === 0 || spec.planKeys.length === 0) {
    throw new Error('צריך לפחות דמות אחת ותוכנית אחת')
  }
  const jobs = planSweep(spec)
  const { error } = await client.from('simulation_jobs').insert(jobs)
  if (error) throw new Error(`הוספת עבודות נכשלה: ${error.message}`)
  return jobs.length
}
