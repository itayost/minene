import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { BotConfig } from '../../../../src/persuade/engine/config';
import { validateConfig } from '../../../../src/persuade/engine/config';
import { DEFAULT_RULES, detectOutcome, initialState } from '../../../../src/persuade/engine/rules';
import { applyTargetReply, persuaderTurn } from '../../../../src/persuade/engine/turn';
import type { ConversationState, Run, Turn } from '../../../../src/persuade/engine/types';
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model';
import { recordAsked } from '../../../../src/persuade/lib/assignments';
import { resolveAccess } from '../../../../src/persuade/lib/access';
import { loadAmmunition } from '../../../../src/persuade/engine/ammunition';
import { preparePlan } from '../../../../src/persuade/engine/prepare';
import { isStorageConfigured, supabase } from '../../../../src/persuade/lib/supabase';
import { saveRun } from '../../../../src/persuade/lib/store';

export const maxDuration = 300;

interface ChatRequest {
  /**
   * `rules` is optional. A caller that is not the /rules page has no business
   * knowing this engine's operating limits -- eran-task's dashboard should not
   * carry a words-per-sentence setting to send back to us -- so it sends the
   * plan alone and gets DEFAULT_RULES.
   *
   * The /rules page still sends its own, which is the entire point of that
   * page: turn a rule off there and it stops being enforced.
   */
  config: Omit<BotConfig, 'rules'> & { rules?: BotConfig['rules'] };
  turns: Turn[];
  /**
   * Optional, for the same reason `rules` is: a caller opening a conversation
   * has no state yet, and constructing one would mean knowing what a rung and a
   * fatigue score are. Absent means "this is the first turn".
   */
  state?: ConversationState;
  /** The person's reply. Absent on the opening move. */
  reply?: string;
  /** Set when the person ends the conversation. */
  finish?: boolean;
  /**
   * The assignment this conversation is about, when there is one. Absent for a
   * conversation driven from the /rules page with no ask behind it.
   *
   * Note what is NOT here: an assignee, and a tenant. Both are read from the
   * assignment and from the caller's own profile, so neither the record of who
   * a conversation was about nor which business it belonged to can be asserted
   * by whoever is driving it.
   */
  assignmentId?: string;
}

/**
 * Builds the plan for one assignment from the knowledge the business approved.
 *
 * Returns null rather than throwing when there is nothing to build from: an
 * assignment whose rule was since rejected, or one in another tenant, are both
 * "no plan" from here and the caller should not be able to tell them apart.
 */
async function planForAssignment(assignmentId: string, tenantId: string) {
  const ammunition = await loadAmmunition(supabase(), assignmentId, tenantId);
  if (!ammunition) return null;

  return preparePlan({
    id: assignmentId,
    topic: ammunition.ask.topicId,
    // The job, not the person's name. The engine is told who it is speaking to
    // in role terms; naming them here would put a person's name into a prompt
    // the plan is cached under.
    targetDescription: ammunition.assignee.jobRoleName ?? 'עובדת בצוות',
    onBehalfOf: null,
    goal: ammunition.ask.text,
    ammunition,
  });
}

/** A person sits in the counterpart's seat and the bot plays the persuader. */
export async function POST(req: Request) {
  try {
    const { config: rawConfig, turns, state: rawState, reply, finish, assignmentId } =
      (await req.json()) as ChatRequest;

    // Before the model is touched: a refused caller must not be able to spend
    // tokens finding out they were refused. Before parsing the body's shape,
    // too -- an unauthenticated caller should not be able to tell a malformed
    // request from a refused one.
    const access = await resolveAccess(req.headers.get('authorization') ?? '', assignmentId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    assertModelAccessConfigured();

    /**
     * The plan comes from the assignment, not from the caller.
     *
     * A conversation about an assignment is grounded in that business's own
     * approved knowledge -- that is the whole seam between this engine and the
     * organisational brain. Before this, the route required the client to send
     * a plan, and the persuade tab had no way to produce one: it posted only
     * an assignmentId, so `rawConfig.rules` threw before any check ran.
     *
     * A client-supplied plan would also be a client choosing which arguments
     * the bot may make, which is not a decision that belongs on that side.
     */
    let config: BotConfig;
    if (rawConfig?.plan) {
      config = { ...rawConfig, rules: rawConfig.rules ?? DEFAULT_RULES };
    } else if (assignmentId) {
      const plan = await planForAssignment(assignmentId, access.context.tenantId);
      if (!plan) {
        return NextResponse.json({ error: 'לא הצלחנו לבנות תוכנית לשיחה הזאת.' }, { status: 422 });
      }
      config = { plan, rules: DEFAULT_RULES } as BotConfig;
    } else {
      return NextResponse.json({ error: 'חסרה תוכנית או משימה.' }, { status: 400 });
    }

    const state = rawState ?? initialState();

    const problems = validateConfig(config);
    if (problems.length > 0) {
      return NextResponse.json(
        { error: problems.map((p) => p.message).join(' · ') }, { status: 400 },
      );
    }

    let workingTurns = turns;
    let workingState = state;

    if (reply?.trim()) {
      const applied = applyTargetReply(reply.trim(), workingTurns, workingState, config.rules);
      workingTurns = [...workingTurns, applied.turn];
      workingState = applied.state;
    }

    if (finish) {
      /**
       * The outcome is re-derived here, never taken from the body.
       *
       * `state` arrives from the caller, and writing it verbatim meant a client
       * could POST {finish: true, state: {outcome: 'agreed'}} and record an
       * agreement that never happened, attributed to the assignee -- in the one
       * system whose whole purpose is measuring persuasion honestly.
       *
       * The turns are the evidence. The outcome is a reading of them, and this
       * side does the reading.
       */
      // Read from what the counterpart actually said last, which is the only
      // evidence there is. An exchange with no reply from them at all cannot
      // have produced an agreement, so it stays open.
      const lastFromTarget = [...workingTurns].reverse().find((t) => t.role === 'target');
      workingState = {
        ...workingState,
        outcome: lastFromTarget ? detectOutcome(lastFromTarget.text) : 'open',
      };

      const run: Run = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        planId: config.plan.id,
        personaId: null,
        plan: config.plan,
        persona: null,
        turns: workingTurns,
        state: workingState,
        violations: workingTurns.flatMap((t) => t.violations ?? []),
      };
      // Both writes are swallowed on purpose, as the save always has been: a
      // storage failure must not turn a finished conversation into an error the
      // person sees after they have already had it. The conversation is the
      // thing that happened; the record of it is best-effort.
      if (isStorageConfigured()) {
        await saveRun(run, access.context).catch(() => undefined);
        // Records that the ask was made. Deliberately does NOT settle the
        // assignment, whatever the outcome: agreement is not execution, and the
        // assignment stays open until somebody reports the thing actually
        // happened. See src/lib/assignments.ts.
        if (assignmentId) {
          await recordAsked(supabase(), assignmentId, workingState).catch(() => undefined);
        }
      }
      return NextResponse.json({ turns: workingTurns, state: workingState, run });
    }

    const result = await persuaderTurn(config.plan, workingTurns, workingState, config.rules);
    return NextResponse.json({
      turns: [...workingTurns, result.turn],
      state: result.state,
      stopped: result.stopped,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
