import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { measuredInputs, preparePlan, preparePrompt, type PrepareInput } from '../engine/prepare';
import type { PersuasionPlan } from '../engine/types';
import { modelId } from './model';

/**
 * The prepared plan, built once instead of once per message.
 *
 * Stage 0 is a large structured generation on the planner model, and the chat
 * route was running it on every turn: the client sends no plan by design, so
 * the route rebuilt it from the ammunition each time and every message paid for
 * two model calls where one was needed. The plan was identical every time.
 *
 * Two layers, and they answer different failures. The table survives a cold
 * start, which is the one that matters on Vercel -- a conversation is five
 * requests and there is no promise they land on the same instance. The memory
 * map in front of it saves the round trip when they do.
 */

/**
 * Hashed over the rendered prompt, not over the fields it was built from.
 *
 * `formatAmmunition` decides what actually reaches the planner, and it has
 * already grown sections since it was written. A fingerprint over a hand-picked
 * list of ammunition fields would keep serving a stale plan the first time
 * somebody added another one -- silently, and only in production, where the
 * knowledge base is real. Hashing the prompt itself cannot drift, because the
 * thing hashed is the input.
 *
 * Three parts, and each is here for its own reason:
 *
 *   - the planner's model id, because switching models changes the plan and
 *     it must not hit a row the previous model wrote;
 *   - the prompt, which is everything the model is told;
 *   - `measuredInputs`, the one thing that shapes the plan without passing
 *     through the prompt at all. A rule's rating is applied in code after the
 *     model answers -- deliberately, since the rules are enforced in code and
 *     not asked for in a prompt -- so a re-rating is invisible to the prompt.
 *     Hashing the prompt alone would keep serving a plan whose arguments are
 *     ranked by yesterday's votes: right arguments, wrong order, and nobody
 *     would ever notice.
 */
export function planFingerprint(input: PrepareInput): string {
  const { system, prompt } = preparePrompt(input);
  const parts = [modelId('planner'), system, prompt, measuredInputs(input)];
  // Joined on a character none of the parts can contain. Concatenated bare,
  // a prompt ending in one field's text would hash the same as the next field
  // beginning with it.
  return createHash('sha256').update(parts.join('\u0000')).digest('hex');
}

interface PlanRow {
  plan: PersuasionPlan;
}

/**
 * Bounded, and bounded by count rather than by time.
 *
 * There is no TTL because there is nothing for one to fix: the fingerprint is
 * the invalidation, so an entry is either still correct or unreachable. A
 * capacity limit is only here to stop a long-lived instance holding every plan
 * it has ever seen.
 */
const MEMORY_LIMIT = 100;
const memory = new Map<string, PersuasionPlan>();

const memoryKey = (tenantId: string, assignmentId: string, fingerprint: string) =>
  `${tenantId}:${assignmentId}:${fingerprint}`;

function remember(key: string, plan: PersuasionPlan): void {
  // Delete-then-set moves an existing key to the end, so insertion order
  // becomes least-recently-used order and the eviction below drops the coldest
  // entry rather than the oldest one that is still in active use.
  memory.delete(key);
  memory.set(key, plan);
  if (memory.size > MEMORY_LIMIT) {
    const coldest = memory.keys().next();
    if (!coldest.done) memory.delete(coldest.value);
  }
}

/** Test seam, and the escape hatch for a deploy that needs to drop the cache. */
export function clearPlanMemory(): void {
  memory.clear();
}

export function createPlanStore(client: SupabaseClient) {
  return {
    async read(
      assignmentId: string,
      tenantId: string,
      fingerprint: string,
    ): Promise<PersuasionPlan | null> {
      const { data, error } = await client
        .from('persuasion_plans')
        .select('plan')
        // This client holds the secret key and bypasses RLS, so the tenant is
        // compared here or nowhere -- the same contract loadAmmunition operates
        // under, and the reason getRun in store.ts takes a required tenantId.
        .eq('tenant_id', tenantId)
        .eq('assignment_id', assignmentId)
        .eq('fingerprint', fingerprint)
        .maybeSingle();

      // A cache is not allowed to break the thing it accelerates. A read that
      // fails is a miss, and a miss costs a plan rather than a conversation.
      if (error || !data) return null;
      return (data as unknown as PlanRow).plan;
    },

    async write(
      assignmentId: string,
      tenantId: string,
      fingerprint: string,
      plan: PersuasionPlan,
    ): Promise<void> {
      // onConflict rather than a plain insert: two conversations opened at once
      // on the same assignment both miss, both build, and both write. The
      // second is the same plan for the same prompt, so it is an overwrite of
      // an identical row, not a duplicate and not an error.
      const { error } = await client
        .from('persuasion_plans')
        .upsert(
          { tenant_id: tenantId, assignment_id: assignmentId, fingerprint, plan },
          { onConflict: 'assignment_id,fingerprint' },
        );
      // Swallowed on purpose, as the run save is: failing to cache a plan must
      // not fail a conversation that has a perfectly good plan in hand.
      if (error) return;
    },
  };
}

export type PlanStore = ReturnType<typeof createPlanStore>;

/**
 * The plan for one assignment: from memory, else from the table, else built.
 *
 * `store` is injectable rather than reached for, because the drafting path has
 * no table to reach -- `/rules` builds a plan from free text with no assignment
 * behind it, and passing null there is what says "this one is not cacheable"
 * instead of leaving it to a null check three layers down.
 */
export async function planFor(
  input: PrepareInput,
  store: PlanStore | null,
  tenantId: string | null,
): Promise<PersuasionPlan> {
  if (!store || !tenantId) return preparePlan(input);

  const assignmentId = input.id;
  const fingerprint = planFingerprint(input);
  const key = memoryKey(tenantId, assignmentId, fingerprint);

  const held = memory.get(key);
  if (held) {
    // Re-inserted so a plan being used right now is the last thing evicted.
    remember(key, held);
    return held;
  }

  const stored = await store.read(assignmentId, tenantId, fingerprint);
  if (stored) {
    remember(key, stored);
    return stored;
  }

  const built = await preparePlan(input);
  remember(key, built);
  await store.write(assignmentId, tenantId, fingerprint, built);
  return built;
}
