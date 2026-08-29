import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_RULES, type RuleConfig } from '../engine/rules'

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
  arms: ExperimentArm[]
  /** Every arm runs against every one of these. */
  pairs: { personaKey: string; planKey: string }[]
  industry?: string
  jobRoleId?: string | null
  need?: string | null
  /** How many times each (arm, pair) combination runs. */
  repeats?: number
}

export interface QueuedJob {
  experiment: string
  variant: string
  persona_key: string
  plan_key: string
  industry: string
  job_role_id: string | null
  need: string | null
  rules: RuleConfig
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
          job_role_id: spec.jobRoleId ?? null,
          need: spec.need ?? null,
          rules: arm.rules,
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
  // together did something, and nothing about which.
  if (spec.arms.length === 2) {
    const [a, b] = spec.arms as [ExperimentArm, ExperimentArm]
    const differing = (Object.keys(DEFAULT_RULES) as (keyof RuleConfig)[]).filter(
      (key) => a.rules[key] !== b.rules[key],
    )
    if (differing.length > 1) {
      problems.push(
        `הזרועות נבדלות ביותר מהגדרה אחת (${differing.join(', ')}) — לא יהיה אפשר לדעת מה גרם למה`,
      )
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
