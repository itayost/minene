import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Stops the loop when runs are failing, before it spends a day's cap on them.
 *
 * At 1,000 runs a day a broken deploy, a revoked key or an exhausted quota
 * fails every job, and a failed job can still have paid for ten model calls
 * before the judge threw. The cap bounds the damage to a day; this bounds it to
 * about an hour.
 *
 * It latches rather than closing on its own: the reader always returns the
 * last `minSamples` finished jobs, however old, with no time filter. Once
 * those are mostly failures the breaker stays open -- and because open means
 * no claims, no new outcomes arrive to dilute the sample, so it cannot
 * re-close by the window simply moving past the failures. What lets it
 * recover is the probe: once the newest of those samples is older than
 * `windowMinutes`, one tick's worth of jobs is let through to find out
 * whether the outage is over. If that batch fails too, it becomes the newest
 * sample and the latch holds for another window.
 */

export interface BreakerSettings {
  windowMinutes: number
  minSamples: number
  failRatio: number
}

export const DEFAULT_BREAKER: BreakerSettings = {
  windowMinutes: 60,
  minSamples: 20,
  failRatio: 0.8,
}

/** One finished job, as far as the breaker needs to know about it. */
export interface BreakerOutcome {
  status: string
  updatedAt: string
}

export type BreakerVerdict = { open: false } | { open: true; failed: number; total: number }

export function breakerVerdict(
  outcomes: readonly BreakerOutcome[],
  settings: BreakerSettings,
  now: Date,
): BreakerVerdict {
  const total = outcomes.length
  if (total < settings.minSamples) return { open: false }

  const newestMs = outcomes.reduce(
    (latest, outcome) => Math.max(latest, new Date(outcome.updatedAt).getTime()),
    0,
  )
  const windowStartMs = now.getTime() - settings.windowMinutes * 60_000
  // The probe: the sample is stale, so let one batch through to refresh it
  // rather than latching shut on evidence nobody can update any more.
  if (newestMs < windowStartMs) return { open: false }

  const failed = outcomes.filter((outcome) => outcome.status === 'failed').length
  return failed / total > settings.failRatio ? { open: true, failed, total } : { open: false }
}

/**
 * The last `settings.minSamples` finished jobs, newest first. No time filter:
 * windowing is `breakerVerdict`'s job now, via the probe, not the query's --
 * see the module doc for why a time-filtered read let failures age out and
 * re-close the breaker during a real outage.
 */
export async function readRecentOutcomes(
  client: SupabaseClient,
  settings: BreakerSettings = DEFAULT_BREAKER,
): Promise<BreakerOutcome[]> {
  const { data, error } = await client
    .from('simulation_jobs')
    .select('status, updated_at')
    .in('status', ['done', 'failed'])
    .order('updated_at', { ascending: false })
    .limit(settings.minSamples)

  // An unreadable sample is not an empty one. Failing closed costs one tick.
  if (error) throw new Error(`בדיקת המפסק נכשלה: ${error.message}`)
  return ((data ?? []) as { status: string; updated_at: string }[]).map((row) => ({
    status: row.status,
    updatedAt: row.updated_at,
  }))
}
