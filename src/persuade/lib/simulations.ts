import type { SupabaseClient } from '@supabase/supabase-js'
import type { Run } from '../engine/types'
import { modelId } from './model'

/**
 * Where a simulation belongs in the matrix.
 *
 * `need` is nullable because the third axis is not always known: a run against
 * a persona and a role is already a cell, and forcing a need would invent one.
 */
export interface SimulationCell {
  industry: string
  jobRoleId: string | null
  need?: string | null
}

export interface StoredSimulation {
  id: string
  cell: { industry: string; jobRoleId: string | null }
  run: Run
}

/**
 * Every column the screen needs and not one more.
 *
 * `turns` is the whole conversation. The lab screen reads state.outcome for the
 * rate, state.blockers for the blocker list and score for the bank, and never
 * the turns themselves -- so paging them in is hundreds of megabytes spent to
 * compute a percentage once the loop runs at its cap.
 *
 * `score` is the one column here that matters most and is easiest to drop by
 * habit: buildBank keys off `run.score?.winningCategory`, so a bank assembled
 * from rows that never carried it comes back empty however many were scored.
 */
const SUMMARY_COLUMNS =
  'id,industry,job_role_id,need,persona_id,plan,state,outcome,score,created_at'

interface SimulationRow {
  id: string
  industry: string
  job_role_id: string | null
  persona_id: string | null
  plan: Run['plan']
  // Absent rather than null on a summary row: SUMMARY_COLUMNS never selects
  // it, and toStored's `row.turns ?? []` treats "absent" the same as "null".
  turns?: Run['turns'] | null
  state: Run['state']
  score: Run['score'] | null
  created_at: string
}

const toStored = (row: SimulationRow): StoredSimulation => {
  const turns = row.turns ?? []
  return {
    id: row.id,
    cell: { industry: row.industry, jobRoleId: row.job_role_id },
    run: {
      id: row.id,
      createdAt: row.created_at,
      planId: row.plan?.id ?? '',
      personaId: row.persona_id,
      plan: row.plan,
      persona: null,
      turns,
      state: row.state,
      // Derived from the turns, never stored: a saved copy would be a second
      // source of truth for something the turns already answer.
      violations: turns.flatMap((t) => t.violations ?? []),
      ...(row.score ? { score: row.score } : {}),
    },
  }
}

export function createSimulationsStore(client: SupabaseClient) {
  return {
    /**
     * No tenant, no assignment, and that is the design rather than an omission.
     *
     * A simulation is an invented scenario against a synthetic persona, so it
     * carries no business's knowledge -- which is exactly what lets the bank
     * built from it be shared across tenants. Writing a tenant here would make
     * the table lie about the one property the whole matrix rests on.
     */
    async saveSimulation(run: Run, cell: SimulationCell): Promise<void> {
      const { error } = await client.from('simulations').insert({
        id: run.id,
        industry: cell.industry,
        job_role_id: cell.jobRoleId,
        need: cell.need ?? null,
        persona_id: run.personaId,
        plan: run.plan,
        turns: run.turns,
        state: run.state,
        outcome: run.state.outcome,
        // Explicitly null rather than omitted: null means "not yet scored",
        // which is a different fact from a column that was never written.
        score: run.score ?? null,
        // Recorded for the same reason the worker records it: a run is the
        // output of a config AND the models that executed it. This writer was
        // omitting it, so every run started from the lab landed unattributed
        // and held the reporting gap open indefinitely. The readers tolerate
        // unattributed rows because of the historical backfill, and that
        // tolerance was quietly covering for a live writer as well.
        models: {
          persuader: modelId('persuader'),
          target: modelId('target'),
          judge: modelId('judge'),
        },
      })

      if (error) throw new Error(`שמירת הסימולציה נכשלה: ${error.message}`)
    },

    /**
     * Every row, paged rather than capped.
     *
     * A `.limit(n)` here would silently drop everything older than the newest
     * n once the table passed that size -- the matrix would show cells as
     * unrun and the bank would forget arguments that won, both without saying
     * a number was ever left out. The worker queues up to
     * `PERSUADER_DAILY_RUN_CAP` runs a day, so a fixed cap is not a distant
     * risk here, it is a matter of days.
     *
     * Without the conversations, and deliberately the only reader left: a
     * `listSimulations` that paged `turns` in too used to sit beside this one
     * with no caller anywhere in the repo, which is a second way to pay the
     * cost this method exists to avoid -- someone reaching for the wrong one
     * out of habit. It was removed rather than kept "just in case".
     */
    async listSimulationSummaries(pageSize = 1000): Promise<StoredSimulation[]> {
      const rows: SimulationRow[] = []
      // The window advances by what came back, not by what was asked for, and
      // stops only on an empty page. PostgREST caps a response at its own
      // max-rows: if that cap is below `pageSize` every page arrives short,
      // and treating a short page as the last one would stop on the first --
      // reintroducing the truncation this loop exists to prevent.
      for (let from = 0; ; ) {
        const { data, error } = await client
          .from('simulations')
          .select(SUMMARY_COLUMNS)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1)

        if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`)
        const page = (data ?? []) as SimulationRow[]
        if (page.length === 0) break
        rows.push(...page)
        from += page.length
      }
      // toStored reads row.turns, which a summary row does not have. It already
      // falls back to [], so violations comes back empty rather than undefined.
      return rows.map(toStored)
    },

    async countSimulations(): Promise<number> {
      const { count, error } = await client
        .from('simulations')
        .select('id', { count: 'exact', head: true })
      if (error) throw new Error(`ספירת הסימולציות נכשלה: ${error.message}`)
      return count ?? 0
    },

    async countSimulationsSince(iso: string): Promise<number> {
      const { count, error } = await client
        .from('simulations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', iso)
      if (error) throw new Error(`ספירת הסימולציות של היום נכשלה: ${error.message}`)
      return count ?? 0
    },

    /**
     * What the daily cap actually bounds. worker.ts counts jobs claimed since
     * UTC midnight, any status, because a failed job has already spent its
     * model calls. Showing runs-added against that cap would understate the
     * spend every time a job fails, and 249 of 413 have.
     */
    async countAttemptsSince(iso: string): Promise<number> {
      const { count, error } = await client
        .from('simulation_jobs')
        .select('id', { count: 'exact', head: true })
        .gte('claimed_at', iso)
      if (error) throw new Error(`ספירת הניסיונות של היום נכשלה: ${error.message}`)
      return count ?? 0
    },
  }
}
