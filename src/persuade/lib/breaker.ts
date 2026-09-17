import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Stops the loop when runs are failing, before it spends a day's cap on them.
 *
 * At 1,000 runs a day a broken deploy, a revoked key or an exhausted quota
 * fails every job, and a failed job can still have paid for ten model calls
 * before the judge threw. The cap bounds the damage to a day; this bounds it to
 * about an hour.
 *
 * It closes on its own: as the window moves past the failures, the verdict
 * reads the successes that came before and after them.
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

export type BreakerVerdict = { open: false } | { open: true; failed: number; total: number }

export function breakerVerdict(
  statuses: readonly string[],
  settings: BreakerSettings,
): BreakerVerdict {
  const total = statuses.length
  if (total < settings.minSamples) return { open: false }
  const failed = statuses.filter((status) => status === 'failed').length
  return failed / total > settings.failRatio ? { open: true, failed, total } : { open: false }
}

/** Statuses of jobs that finished inside the window. Throws rather than reporting an empty window. */
export async function readRecentOutcomes(
  client: SupabaseClient,
  settings: BreakerSettings = DEFAULT_BREAKER,
  now: Date = new Date(),
): Promise<string[]> {
  const since = new Date(now.getTime() - settings.windowMinutes * 60_000).toISOString()
  const { data, error } = await client
    .from('simulation_jobs')
    .select('status')
    .in('status', ['done', 'failed'])
    .gte('updated_at', since)
    .limit(1000)

  // An unreadable window is not an empty one. Failing closed costs one tick.
  if (error) throw new Error(`בדיקת המפסק נכשלה: ${error.message}`)
  return ((data ?? []) as { status: string }[]).map((row) => row.status)
}
