import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { BotConfig } from '../../../../src/persuade/engine/config';
import { validateConfig } from '../../../../src/persuade/engine/config';
import { DEFAULT_RULES, initialState } from '../../../../src/persuade/engine/rules';
import { applyTargetReply, persuaderTurn } from '../../../../src/persuade/engine/turn';
import type { ConversationState, Run, Turn } from '../../../../src/persuade/engine/types';
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model';
import { recordAsked } from '../../../../src/persuade/lib/assignments';
import { resolveAccess } from '../../../../src/persuade/lib/access';
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

/** A person sits in the counterpart's seat and the bot plays the persuader. */
export async function POST(req: Request) {
  try {
    assertModelAccessConfigured();
    const { config: rawConfig, turns, state: rawState, reply, finish, assignmentId } =
      (await req.json()) as ChatRequest;
    const config: BotConfig = { ...rawConfig, rules: rawConfig.rules ?? DEFAULT_RULES };
    const state = rawState ?? initialState();

    // Before the model is touched: a refused caller must not be able to spend
    // tokens finding out they were refused.
    const access = await resolveAccess(req.headers.get('authorization') ?? '', assignmentId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

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
