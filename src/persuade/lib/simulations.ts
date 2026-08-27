import type { SupabaseClient } from '@supabase/supabase-js';
import type { Run } from '../engine/types';

/**
 * Where a simulation belongs in the matrix.
 *
 * `need` is nullable because the third axis is not always known: a run against
 * a persona and a role is already a cell, and forcing a need would invent one.
 */
export interface SimulationCell {
  industry: string;
  jobRoleId: string | null;
  need?: string | null;
}

export interface StoredSimulation {
  id: string;
  cell: { industry: string; jobRoleId: string | null };
  run: Run;
}

/**
 * Every column the bank and the rates read.
 *
 * `score` is the one that matters and the one the conversations store drops:
 * buildBank keys off `run.score?.winningCategory`, so a bank assembled from
 * rows that never carried a score comes back empty however many were scored.
 */
const SIMULATION_COLUMNS = 'id,industry,job_role_id,need,persona_id,plan,turns,state,outcome,score,created_at';

interface SimulationRow {
  id: string;
  industry: string;
  job_role_id: string | null;
  persona_id: string | null;
  plan: Run['plan'];
  turns: Run['turns'] | null;
  state: Run['state'];
  score: Run['score'] | null;
  created_at: string;
}

const toStored = (row: SimulationRow): StoredSimulation => {
  const turns = row.turns ?? [];
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
  };
};

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
      });

      if (error) throw new Error(`שמירת הסימולציה נכשלה: ${error.message}`);
    },

    async listSimulations(limit = 500): Promise<StoredSimulation[]> {
      const { data, error } = await client
        .from('simulations')
        .select(SIMULATION_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`);
      return ((data ?? []) as SimulationRow[]).map(toStored);
    },
  };
}
