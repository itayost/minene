import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { loadAmmunition } from '../../../../src/persuade/engine/ammunition'
import type { BotConfig } from '../../../../src/persuade/engine/config'
import { validateConfig } from '../../../../src/persuade/engine/config'
import { DEFAULT_RULES, detectOutcome, initialState } from '../../../../src/persuade/engine/rules'
import { applyTargetReply, streamPersuaderTurn } from '../../../../src/persuade/engine/turn'
import type { ConversationState, Run, Turn } from '../../../../src/persuade/engine/types'
import { resolveAccess } from '../../../../src/persuade/lib/access'
import { recordAsked } from '../../../../src/persuade/lib/assignments'
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model'
import { createPlanStore, planFor } from '../../../../src/persuade/lib/plans'
import { saveRun } from '../../../../src/persuade/lib/store'
import { isStorageConfigured, supabase } from '../../../../src/persuade/lib/supabase'

export const maxDuration = 300

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
  config: Omit<BotConfig, 'rules'> & { rules?: BotConfig['rules'] }
  turns: Turn[]
  /**
   * Optional, for the same reason `rules` is: a caller opening a conversation
   * has no state yet, and constructing one would mean knowing what a rung and a
   * fatigue score are. Absent means "this is the first turn".
   */
  state?: ConversationState
  /** The person's reply. Absent on the opening move. */
  reply?: string
  /** Set when the person ends the conversation. */
  finish?: boolean
  /**
   * The assignment this conversation is about, when there is one. Absent for a
   * conversation driven from the /rules page with no ask behind it.
   *
   * Note what is NOT here: an assignee, and a tenant. Both are read from the
   * assignment and from the caller's own profile, so neither the record of who
   * a conversation was about nor which business it belonged to can be asserted
   * by whoever is driving it.
   */
  assignmentId?: string
}

/**
 * Builds the plan for one assignment from the knowledge the business approved.
 *
 * Returns null rather than throwing when there is nothing to build from: an
 * assignment whose rule was since rejected, or one in another tenant, are both
 * "no plan" from here and the caller should not be able to tell them apart.
 */
async function planForAssignment(assignmentId: string, tenantId: string) {
  const client = supabase()
  const ammunition = await loadAmmunition(client, assignmentId, tenantId)
  if (!ammunition) return null

  /**
   * Built once per assignment, not once per message.
   *
   * This used to call preparePlan directly, so every turn of every conversation
   * paid for a full stage-0 generation on the planner model before the turn
   * itself ran -- two large model calls per message, for a plan that was
   * identical each time. That is the larger half of "זמן התגובה בלתי אפשרי",
   * and it is invisible from the client, which correctly sends no plan at all.
   *
   * planFor keys on a hash of the planner prompt, so a re-rated rule, a new
   * objection or the history moving after an ask is recorded all produce a
   * fresh plan on their own. Nothing here has to remember to invalidate.
   */
  return planFor(
    {
      id: assignmentId,
      topic: ammunition.ask.topicId,
      // The job, not the person's name. The engine is told who it is speaking to
      // in role terms; naming them here would put a person's name into a prompt
      // the plan is cached under.
      targetDescription: ammunition.assignee.jobRoleName ?? 'עובדת בצוות',
      onBehalfOf: null,
      goal: ammunition.ask.text,
      ammunition,
    },
    createPlanStore(client),
    tenantId,
  )
}

/**
 * One line of NDJSON per event, the same protocol /api/persuade/simulate has
 * used since it was written.
 *
 * The route streams because the wait is the product problem: a manager pressing
 * שליחה used to watch "חושבת…" for the whole generation, since a single JSON
 * body cannot arrive until its last field is written. The message is now on
 * screen while the bookkeeping fields behind it are still being produced.
 *
 * Refusals are not streamed. 401, 403 and 503 stay status codes, because they
 * are decided before a byte is written and because the client acts on them --
 * an expired session has to send someone to sign in, and it cannot do that from
 * a 200 carrying a sad message. Everything after the access check streams,
 * including the paths that never touch a model, so the client has one reader
 * rather than a guess about which format is coming.
 */
function ndjson(produce: (emit: (event: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
      try {
        await produce(emit)
      } catch (error) {
        // Emitted into the stream rather than thrown, because by this point the
        // response has already begun: the status line is long gone and a throw
        // would close the body mid-conversation, which the client cannot tell
        // apart from a network drop.
        const message = error instanceof Error ? error.message : 'שגיאה לא ידועה'
        emit({ type: 'error', message })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

/**
 * A person sits in the counterpart's seat and the bot plays the persuader.
 *
 * Two phases, split on one question: is this still decidable with a status
 * code? Who the caller is, and whether they may act on this assignment, are.
 * Everything after that -- preparing the plan, writing the move -- happens
 * inside the stream, so the message reaches the screen while it is still being
 * written instead of after it is finished.
 */
export async function POST(req: Request) {
  let request: ChatRequest
  try {
    request = (await req.json()) as ChatRequest
  } catch {
    return NextResponse.json({ error: 'הבקשה לא נקראה.' }, { status: 400 })
  }

  const { config: rawConfig, turns, state: rawState, reply, finish, assignmentId } = request

  // Before the model is touched: a refused caller must not be able to spend
  // tokens finding out they were refused. Before the stream opens, too, since
  // a refusal is the one answer here that has to arrive as a status.
  const access = await resolveAccess(req.headers.get('authorization') ?? '', assignmentId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  return ndjson(async (emit) => {
    assertModelAccessConfigured()

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
    let config: BotConfig
    if (rawConfig?.plan) {
      config = { ...rawConfig, rules: rawConfig.rules ?? DEFAULT_RULES }
    } else if (assignmentId) {
      // Announced rather than waited out in silence. A cached plan makes this
      // step invisible, but the first conversation on an assignment still has
      // to build one, and that is the only slow moment left -- so the screen
      // gets to say which moment it is in.
      emit({ type: 'preparing' })
      const plan = await planForAssignment(assignmentId, access.context.tenantId)
      if (!plan) throw new Error('לא הצלחנו לבנות תוכנית לשיחה הזאת.')
      config = { plan, rules: DEFAULT_RULES } as BotConfig
    } else {
      throw new Error('חסרה תוכנית או משימה.')
    }

    const state = rawState ?? initialState()

    const problems = validateConfig(config)
    if (problems.length > 0) throw new Error(problems.map((p) => p.message).join(' · '))

    let workingTurns = turns
    let workingState = state

    if (reply?.trim()) {
      const applied = applyTargetReply(reply.trim(), workingTurns, workingState, config.rules)
      workingTurns = [...workingTurns, applied.turn]
      workingState = applied.state
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
      const lastFromTarget = [...workingTurns].reverse().find((t) => t.role === 'target')
      workingState = {
        ...workingState,
        outcome: lastFromTarget ? detectOutcome(lastFromTarget.text) : 'open',
      }

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
      }
      // Both writes are swallowed on purpose, as the save always has been: a
      // storage failure must not turn a finished conversation into an error the
      // person sees after they have already had it. The conversation is the
      // thing that happened; the record of it is best-effort.
      if (isStorageConfigured()) {
        await saveRun(run, access.context).catch(() => undefined)
        // Records that the ask was made. Deliberately does NOT settle the
        // assignment, whatever the outcome: agreement is not execution, and the
        // assignment stays open until somebody reports the thing actually
        // happened. See src/lib/assignments.ts.
        if (assignmentId) {
          await recordAsked(supabase(), assignmentId, workingState).catch(() => undefined)
        }
      }
      emit({ type: 'result', turns: workingTurns, state: workingState, run })
      return
    }

    for await (const event of streamPersuaderTurn(
      config.plan,
      workingTurns,
      workingState,
      config.rules,
    )) {
      if (event.type === 'delta') {
        emit(event)
        continue
      }
      emit({
        type: 'result',
        turns: [...workingTurns, event.result.turn],
        state: event.result.state,
        stopped: event.result.stopped,
      })
    }
  })
}
