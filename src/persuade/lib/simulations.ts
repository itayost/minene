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
  /**
   * The experiment this run belongs to, null for an ordinary sweep run.
   *
   * An experiment arm runs under a `RuleConfig` deliberately different from the
   * deployed default (see `queueExperiment` in lib/experiments.ts) -- that is
   * the whole point of an arm. The matrix and the bank read every row in this
   * table without distinguishing the two, which pools a run against a 25-word
   * cap into the same cell as one against the deployed default. `matrixFrom`
   * and the lab panel both filter this out; see `isComparable`.
   */
  experiment: string | null
  run: Run
}

/**
 * Every column the bank and the rates read.
 *
 * `score` is the one that matters and the one the conversations store drops:
 * buildBank keys off `run.score?.winningCategory`, so a bank assembled from
 * rows that never carried a score comes back empty however many were scored.
 */
const SIMULATION_COLUMNS =
  'id,industry,job_role_id,need,persona_id,plan,turns,state,outcome,score,experiment,created_at'

interface SimulationRow {
  id: string
  industry: string
  job_role_id: string | null
  persona_id: string | null
  plan: Run['plan']
  turns: Run['turns'] | null
  state: Run['state']
  score: Run['score'] | null
  experiment: string | null
  created_at: string
}

const toStored = (row: SimulationRow): StoredSimulation => {
  const turns = row.turns ?? []
  return {
    id: row.id,
    cell: { industry: row.industry, jobRoleId: row.job_role_id },
    experiment: row.experiment ?? null,
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
     */
    async listSimulations(pageSize = 1000): Promise<StoredSimulation[]> {
      const rows: SimulationRow[] = []
      // The window advances by what came back, not by what was asked for, and
      // stops only on an empty page. PostgREST caps a response at its own
      // max-rows: if that cap is below `pageSize` every page arrives short,
      // and treating a short page as the last one would stop on the first --
      // reintroducing the truncation this loop exists to prevent.
      for (let from = 0; ; ) {
        const { data, error } = await client
          .from('simulations')
          .select(SIMULATION_COLUMNS)
          .order('created_at', { ascending: false })
          .range(from, from + pageSize - 1)

        if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`)
        const page = (data ?? []) as SimulationRow[]
        if (page.length === 0) break
        rows.push(...page)
        from += page.length
      }
      return rows.map(toStored)
    },
  }
}
