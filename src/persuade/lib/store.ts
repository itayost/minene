import type { SupabaseClient } from '@supabase/supabase-js';
import type { Run, RuleViolation, Turn } from '../engine/types';
import { supabase } from './supabase';

/**
 * Conversations live in eran-task's Supabase project.
 *
 * They used to be JSON files under `.data/runs`, which is why this module used to
 * refuse to run on Vercel at all ("המעבדה שומרת תוצאות לדיסק ולכן רצה מקומית
 * בלבד"). Putting them in that project rather than a database of their own is what
 * lets a conversation be joined to the assignment it was about and to the
 * knowledge it drew on.
 */

/**
 * Everything the schema needs that a `Run` does not carry. The engine has no
 * concept of a tenant, and adding one to `Run` would push tenancy through the
 * whole engine for the benefit of one module at its edge.
 */
export interface RunContext {
  tenantId: string;
  /** The assignment this conversation is about. Null for a lab run with no real ask behind it. */
  assignmentId?: string | null;
  assigneeId?: string | null;
  channel?: 'in_app' | 'whatsapp' | 'simulation';
}

const TENANT_VAR = 'PERSUADER_TENANT_ID';

/**
 * The lab runs personas against a plan with nobody real on the other side, so it
 * has no assignment and no assignee to derive a tenant from. One env var covers
 * it, and the channel defaults to `simulation` so a lab run can never be counted
 * as evidence about a person -- the schema's own
 * `conversations_persona_matches_channel` enforces the same thing from the other
 * side.
 */
export function defaultContext(): RunContext {
  const tenantId = process.env[TENANT_VAR];
  if (!tenantId) {
    throw new Error(
      `חסר ${TENANT_VAR}. בלי מזהה עסק אי אפשר לשמור שיחה, כי כל שיחה שייכת לעסק אחד.`,
    );
  }
  return { tenantId, channel: 'simulation' };
}

interface TurnRow {
  role: string;
  text: string;
  interaction: number;
  rung: number | null;
  blocker: string | null;
  violations: RuleViolation[] | null;
}

interface ConversationRow {
  id: string;
  started_at: string;
  state: Run['state'];
  outcome: string;
  plan: Run['plan'];
  persona: Run['persona'];
  conversation_turns: TurnRow[] | null;
}

const CONVERSATION_COLUMNS = 'id,started_at,state,outcome,plan,persona';

const toTurn = (row: TurnRow): Turn => ({
  role: row.role as Turn['role'],
  text: row.text,
  interaction: row.interaction,
  ...(row.rung === null ? {} : { rung: row.rung as Turn['rung'] }),
  ...(row.blocker === null ? {} : { blocker: row.blocker as Turn['blocker'] }),
  ...(row.violations?.length ? { violations: row.violations } : {}),
});

/**
 * `Turn.rung`, `Turn.blocker` and `Turn.violations` are optional on the type, and
 * an absent key is not the same as an explicit null to anything that spreads a
 * Turn or counts its keys. Rebuilding them conditionally rather than writing
 * `rung: row.rung ?? undefined` keeps a round-tripped Turn deep-equal to the one
 * that was saved, which is what the store's own tests assert.
 */
function toRun(row: ConversationRow): Run {
  const turns = (row.conversation_turns ?? []).map(toTurn);
  return {
    id: row.id,
    createdAt: row.started_at,
    planId: row.plan?.id ?? '',
    personaId: row.persona?.id ?? null,
    plan: row.plan,
    persona: row.persona,
    turns,
    state: row.state,
    // Derived, never stored. Both call sites build it the same way
    // (`turns.flatMap(t => t.violations ?? [])`), so a stored copy would be a
    // second source of truth for something the turns already answer.
    violations: turns.flatMap((t) => t.violations ?? []),
  };
}

export function createStore(client: SupabaseClient) {
  return {
    async saveRun(run: Run, context: RunContext): Promise<void> {
      const { error } = await client.from('conversations').upsert({
        id: run.id,
        tenant_id: context.tenantId,
        assignment_id: context.assignmentId ?? null,
        assignee_id: context.assigneeId ?? null,
        state: run.state,
        // Promoted out of `state` because it is the one field the other side
        // reasons about: it settles an assignment, the follow-up phase reads it a
        // week later, and every measurement of the bot is grouped by it.
        outcome: run.state.outcome,
        channel: context.channel ?? 'simulation',
        plan: run.plan,
        persona: run.persona,
        started_at: run.createdAt,
        ended_at: new Date().toISOString(),
      });
      if (error) throw new Error(`שמירת השיחה נכשלה: ${error.message}`);

      // Replace rather than append. saveRun is called once at the end of a
      // conversation, but the lab can re-run and re-save the same id, and an
      // append would silently double every turn.
      //
      // Delete-then-insert is not atomic. A failure between them leaves a
      // conversation row with no turns, which reads as an empty conversation
      // rather than as a corrupted one -- the safe direction, and recoverable by
      // saving again.
      const { error: clearError } = await client
        .from('conversation_turns').delete().eq('conversation_id', run.id);
      if (clearError) throw new Error(`שמירת השיחה נכשלה: ${clearError.message}`);

      if (run.turns.length === 0) return;

      const { error: turnsError } = await client.from('conversation_turns').insert(
        run.turns.map((turn) => ({
          conversation_id: run.id,
          role: turn.role,
          text: turn.text,
          interaction: turn.interaction,
          rung: turn.rung ?? null,
          blocker: turn.blocker ?? null,
          violations: turn.violations ?? [],
        })),
      );
      if (turnsError) throw new Error(`שמירת השיחה נכשלה: ${turnsError.message}`);
    },

    async getRun(id: string): Promise<Run | null> {
      const { data, error } = await client
        .from('conversations')
        .select(`${CONVERSATION_COLUMNS},conversation_turns(role,text,interaction,rung,blocker,violations)`)
        .eq('id', id)
        .maybeSingle();
      // A missing row is null, not an error -- the file store answered the same
      // way and both call sites rely on it.
      if (error || !data) return null;
      return toRun(data as unknown as ConversationRow);
    },

    async listRuns(limit = 200): Promise<Run[]> {
      const { data, error } = await client
        .from('conversations')
        .select(`${CONVERSATION_COLUMNS},conversation_turns(role,text,interaction,rung,blocker,violations)`)
        .order('started_at', { ascending: false })
        .limit(limit);
      if (error || !data) return [];
      return (data as unknown as ConversationRow[]).map(toRun);
    },
  };
}

/**
 * The bound store the API routes use. Built lazily: `supabase()` throws when the
 * environment is not configured, and doing that at module scope would take down
 * every route that merely imports this file, including the ones that never save.
 */
export async function saveRun(run: Run, context: RunContext = defaultContext()): Promise<void> {
  return createStore(supabase()).saveRun(run, context);
}

export async function getRun(id: string): Promise<Run | null> {
  return createStore(supabase()).getRun(id);
}

export async function listRuns(limit = 200): Promise<Run[]> {
  return createStore(supabase()).listRuns(limit);
}
