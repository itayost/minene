import type { SupabaseClient } from '@supabase/supabase-js'
import type { RuleConfig } from '../engine/rules'
import { scoreRun } from '../engine/score'
import { runSimulation } from '../engine/simulation'
import type { Run } from '../engine/types'
import { getPersona, getPlan } from './content'

/**
 * The loop that runs simulations without anybody clicking anything.
 *
 * Deliberately holds no tenant and no assignment. A simulation is an invented
 * scenario against a synthetic persona, and that is the whole reason the matrix
 * built on top of it can be read across businesses -- tests/persuade/
 * tenant-boundary.test.ts enforces it on the engine and now on this file too.
 */

/**
 * One run is up to eleven model calls: five persuader turns, five persona
 * replies and the scorer. A loop with no ceiling is a bill with no ceiling, and
 * this project has already had one enforcement mechanism switched off for
 * exactly that reason -- brain-backend's CI, paused to stay inside an Actions
 * budget. A cap that stops the loop is the difference between a lab and a leak.
 */
export const CALLS_PER_RUN = 11
const DAILY_RUN_CAP = Number(process.env.PERSUADER_DAILY_RUN_CAP ?? '200')

export interface JobRow {
  id: string
  experiment: string | null
  variant: string | null
  persona_key: string
  plan_key: string
  industry: string
  job_role_id: string | null
  need: string | null
  rules: RuleConfig
  attempts: number
}

export interface WorkerReport {
  claimed: number
  completed: number
  failed: number
  /** Set when the cap stopped the batch, so a quiet worker is never ambiguous. */
  stopped?: string
}

/** Runs completed today, which is what the cap is measured against. */
async function runsToday(client: SupabaseClient): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count, error } = await client
    .from('simulations')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since.toISOString())

  // A cap that cannot be read is a cap that is not enforced. Failing closed
  // costs a batch; failing open costs money until somebody notices.
  if (error) throw new Error(`בדיקת התקרה היומית נכשלה: ${error.message}`)
  return count ?? 0
}

/**
 * One tick: claim a few jobs, run them, record what happened.
 *
 * A failed job is marked and left rather than retried in place. The claim
 * function re-offers a stale `running` row after thirty minutes and increments
 * `attempts` each time, so a job that fails for a real reason stops being
 * retried by a person looking at `attempts`, not by a silent loop.
 */
export async function tick(client: SupabaseClient, batchSize = 3): Promise<WorkerReport> {
  const today = await runsToday(client)
  if (today >= DAILY_RUN_CAP) {
    return { claimed: 0, completed: 0, failed: 0, stopped: `תקרה יומית: ${today}/${DAILY_RUN_CAP}` }
  }

  const room = Math.min(batchSize, DAILY_RUN_CAP - today)
  const { data, error } = await client.rpc('claim_simulation_jobs', {
    p_limit: room,
    p_stale_minutes: 30,
  })
  if (error) throw new Error(`נטילת עבודות נכשלה: ${error.message}`)

  const jobs = (data ?? []) as JobRow[]
  let completed = 0
  let failed = 0

  for (const job of jobs) {
    try {
      const simulationId = await runJob(client, job)
      await client
        .from('simulation_jobs')
        .update({
          status: 'done',
          simulation_id: simulationId,
          error: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', job.id)
      completed += 1
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'שגיאה לא ידועה'
      await client
        .from('simulation_jobs')
        .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
        .eq('id', job.id)
      failed += 1
    }
  }

  return { claimed: jobs.length, completed, failed }
}

/** One simulation, scored and stored. Returns the simulation id. */
export async function runJob(client: SupabaseClient, job: JobRow): Promise<string> {
  const [persona, plan] = await Promise.all([getPersona(job.persona_key), getPlan(job.plan_key)])

  let run: Run | null = null
  for await (const event of runSimulation({ plan, persona, rules: job.rules })) {
    if (event.type === 'done') run = event.run
  }
  if (!run) throw new Error('הסימולציה הסתיימה בלי תוצאה')

  const score = await scoreRun(run.plan, run.turns, run.state, run.violations)

  const { data, error } = await client
    .from('simulations')
    .insert({
      industry: job.industry,
      job_role_id: job.job_role_id,
      need: job.need,
      persona_id: persona.id,
      plan: run.plan,
      turns: run.turns,
      state: run.state,
      outcome: run.state.outcome,
      score,
      // The two columns that make the run comparable afterwards. Without them a
      // finished run is just a conversation nobody can attribute to a setting.
      rules: job.rules,
      experiment: job.experiment,
      variant: job.variant,
    })
    .select('id')
    .single()

  if (error) throw new Error(`שמירת הסימולציה נכשלה: ${error.message}`)
  return (data as { id: string }).id
}
