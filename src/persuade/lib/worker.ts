import type { SupabaseClient } from '@supabase/supabase-js'
import type { RuleConfig } from '../engine/rules'
import { scoreRun } from '../engine/score'
import { runSimulation } from '../engine/simulation'
import type { Run } from '../engine/types'
import { createUsageMeter, withUsageMeter } from '../engine/usage'
import { isWorldState, personaInWorld, type WorldState } from '../engine/world'
import { type BreakerOutcome, breakerVerdict, DEFAULT_BREAKER, readRecentOutcomes } from './breaker'
import { getPersona, getPlan } from './content'
import { startOfUtcDay } from './day'
import { type FeedReport, refillFeed } from './feed'
import { modelId } from './model'
import { runPool } from './pool'
import { type WorkerSettings, workerSettings } from './worker-settings'

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
 * The cap itself now lives in worker-settings.ts, read per tick, so it can be
 * lowered in Vercel without a deploy.
 *
 * The cap bounds attempts, not successes: it counts jobs claimed today,
 * whatever their outcome. A failed job has still spent up to eleven model
 * calls before it failed, so counting only rows that made it into
 * `simulations` would leave a failing loop unbounded. Room is read once per
 * tick, so two overlapping ticks can each claim up to a full batch before
 * either sees the other's claims -- the cap can overshoot by at most one
 * batch.
 */
export const CALLS_PER_RUN = 11

export interface JobRow {
  id: string
  experiment: string | null
  variant: string | null
  persona_key: string
  plan_key: string
  industry: string
  segment: string | null
  job_role_id: string | null
  need: string | null
  rules: RuleConfig
  world: WorldState | null
  attempts: number
  /** Which pass of the feed queued this job. Null when queued by hand or by an experiment. */
  pass: number | null
}

export interface WorkerReport {
  claimed: number
  completed: number
  failed: number
  /** Set when the cap or the breaker stopped the batch, so a quiet worker is never ambiguous. */
  stopped?: string
  /** What the refill did this tick. An error here does not stop the tick from draining what is queued. */
  feed?: FeedReport | { status: 'error'; message: string }
}

/** The tick's collaborators. Injected so the tick can be tested without a database or a model. */
export interface TickDeps {
  settings: WorkerSettings
  readOutcomes: (client: SupabaseClient) => Promise<BreakerOutcome[]>
  refill: (client: SupabaseClient, settings: WorkerSettings) => Promise<FeedReport>
  runJob: (client: SupabaseClient, job: JobRow) => Promise<string>
}

/** Jobs claimed today, any status, which is what the cap is measured against. */
async function attemptsToday(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('simulation_jobs')
    .select('id', { count: 'exact', head: true })
    .gte('claimed_at', startOfUtcDay())

  // A cap that cannot be read is a cap that is not enforced. Failing closed
  // costs a batch; failing open costs money until somebody notices.
  if (error) throw new Error(`בדיקת התקרה היומית נכשלה: ${error.message}`)
  return count ?? 0
}

/** Runs one claimed job and records its outcome on the queue row. Never throws. */
async function settle(
  client: SupabaseClient,
  job: JobRow,
  run: TickDeps['runJob'],
): Promise<'done' | 'failed'> {
  try {
    const simulationId = await run(client, job)
    await client
      .from('simulation_jobs')
      .update({
        status: 'done',
        simulation_id: simulationId,
        error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', job.id)
    return 'done'
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'שגיאה לא ידועה'
    await client
      .from('simulation_jobs')
      .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
      .eq('id', job.id)
    return 'failed'
  }
}

/**
 * One tick: check the cap and the breaker, top the queue up, claim a batch, run
 * it with bounded concurrency, record what happened.
 *
 * A failed job is marked and left rather than retried in place. The claim
 * function re-offers a stale `running` row after thirty minutes and increments
 * `attempts` each time, so a job that fails for a real reason stops being
 * retried by a person looking at `attempts`, not by a silent loop.
 *
 * Throughput: a tick every ten minutes, eight jobs, four at a time. Runs take
 * about 42 seconds (three took 125s against production), so a tick is roughly
 * two minutes inside maxDuration = 800, and 144 ticks a day can reach 1,152 --
 * above the cap, so the cap is what governs.
 */
export async function tick(
  client: SupabaseClient,
  overrides: Partial<TickDeps> = {},
): Promise<WorkerReport> {
  const deps: TickDeps = {
    settings: overrides.settings ?? workerSettings(),
    readOutcomes: overrides.readOutcomes ?? ((c) => readRecentOutcomes(c, DEFAULT_BREAKER)),
    refill: overrides.refill ?? ((c, s) => refillFeed(c, s)),
    runJob: overrides.runJob ?? runJob,
  }
  const { settings } = deps

  const today = await attemptsToday(client)
  if (today >= settings.dailyCap) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      stopped: `תקרה יומית: ${today}/${settings.dailyCap}`,
    }
  }

  const verdict = breakerVerdict(await deps.readOutcomes(client), DEFAULT_BREAKER, new Date())
  if (verdict.open) {
    return {
      claimed: 0,
      completed: 0,
      failed: 0,
      stopped: `מפסק: ${verdict.failed}/${verdict.total} נכשלו בשעה האחרונה`,
    }
  }

  // Refill before claiming, and never let a refill failure stop the claim: a
  // broken refill with a full queue should still run the queue.
  const feed: WorkerReport['feed'] = await deps
    .refill(client, settings)
    .catch((cause: unknown) => ({
      status: 'error' as const,
      message: cause instanceof Error ? cause.message : 'שגיאה לא ידועה',
    }))

  const room = Math.min(settings.batch, settings.dailyCap - today)
  const { data, error } = await client.rpc('claim_simulation_jobs', {
    p_limit: room,
    p_stale_minutes: 30,
  })
  if (error) throw new Error(`נטילת עבודות נכשלה: ${error.message}`)

  const jobs = (data ?? []) as JobRow[]
  const outcomes = await runPool(jobs, settings.concurrency, (job) =>
    settle(client, job, deps.runJob),
  )

  return {
    claimed: jobs.length,
    completed: outcomes.filter((o) => o === 'done').length,
    failed: outcomes.filter((o) => o === 'failed').length,
    feed,
  }
}

/** One simulation, scored and stored. Returns the simulation id. */
export async function runJob(client: SupabaseClient, job: JobRow): Promise<string> {
  const [loaded, plan] = await Promise.all([getPersona(job.persona_key), getPlan(job.plan_key)])
  // The world owns the circumstance, the secret and the win condition; the
  // persona keeps its name, role and voice. Without a world the persona
  // supplies all of it, which is how a hand-started run still behaves.
  if (job.world !== null && !isWorldState(job.world)) {
    throw new Error('העולם ששמור על העבודה אינו תקין')
  }
  const persona = job.world ? personaInWorld(loaded, job.world) : loaded

  // One meter per job. Jobs run concurrently in this process, and the meter's
  // AsyncLocalStorage scope is what keeps their token counts apart.
  const meter = createUsageMeter()
  const { run, score } = await withUsageMeter(meter, async () => {
    let finished: Run | null = null
    for await (const event of runSimulation({
      plan,
      persona,
      rules: job.rules,
      world: job.world,
    })) {
      if (event.type === 'done') finished = event.run
    }
    if (!finished) throw new Error('הסימולציה הסתיימה בלי תוצאה')
    const judged = await scoreRun(
      finished.plan,
      finished.turns,
      finished.state,
      finished.violations,
    )
    return { run: finished, score: judged }
  })

  const { data, error } = await client
    .from('simulations')
    .insert({
      industry: job.industry,
      job_role_id: job.job_role_id,
      need: job.need,
      // Out of the world and onto its own column. The migration backfilled
      // existing rows and nothing wrote it going forward, so every new run
      // landed with the reason inside the jsonb and the column null -- the
      // report slices on the column.
      reason: job.world?.reason ?? null,
      // Copied out of the plan rather than left in the jsonb: grouping runs by
      // subject should not mean digging through a blob, and the plan frozen
      // into this run can drift from the library plan behind it afterwards.
      topic: plan.topic,
      segment: job.segment ?? null,
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
      // Stored so the run is readable as evidence: a win means little without
      // the world it was won in.
      world: job.world,
      // A run is the output of a config AND the models that executed it.
      // Without this, swapping PERSUADER_MODEL makes every comparison spanning
      // the swap measure the model rather than the setting -- and still render
      // as a clean difference between two arms.
      models: {
        persuader: modelId('persuader'),
        target: modelId('target'),
        judge: modelId('judge'),
      },
      // What this run cost, so the cap can become a budget once the real
      // number is known rather than guessed.
      usage: meter.totals(),
      pass: job.pass ?? null,
    })
    .select('id')
    .single()

  if (error) {
    // By the time this insert runs, the job has already paid for up to
    // eleven model calls. A bare Postgres check-constraint message reads like
    // any other storage failure -- naming the missing migration here is the
    // difference between reading `simulation_jobs.error` and fixing it in a
    // minute, versus re-diagnosing a generic insert failure from scratch.
    if (isMissingOutcomeMigration(error)) {
      throw new Error(
        `שמירת הסימולציה נכשלה: אילוץ הבדיקה על העמודה outcome לא מכיל את הערך שהריצה הפיקה. ` +
          `כנראה שהמיגרציה 20260918120000_no_response_outcome (eran-task) עדיין לא הורצה על מסד הנתונים הזה. ` +
          `(${error.message})`,
      )
    }
    throw new Error(`שמירת הסימולציה נכשלה: ${error.message}`)
  }
  return (data as { id: string }).id
}

/** A Postgres check_violation (23514) whose message names the `outcome` column. */
function isMissingOutcomeMigration(error: { code?: string; message?: string }): boolean {
  return (
    error.code === '23514' && typeof error.message === 'string' && error.message.includes('outcome')
  )
}
