import type { SupabaseClient } from '@supabase/supabase-js'
import type { ConversationState } from '../engine/types'

/**
 * What a finished conversation writes back to the assignment it was about.
 *
 * The one rule this module exists to hold: **agreement is not execution.**
 *
 * A conversation that ends in "סגור, אני עושה את זה" has produced a commitment
 * and nothing else. A sent message is not execution, a read one is not
 * execution, and "סבבה" is not execution. So a finished conversation never sets
 * an assignment to `done` -- it records that the ask was made, and the
 * assignment stays open until somebody reports or observes that the thing
 * actually happened.
 *
 * Collapsing the two would make the whole follow-up phase pointless, and would
 * make every measurement of this bot a measurement of how agreeable people are.
 */

export type ExecutionReport = 'yes' | 'partial' | 'no'

/**
 * Called when a conversation ends, whatever its outcome. Writes the audit row
 * and leaves `assignments.status` alone.
 *
 * The note carries the outcome so the trail says what kind of conversation it
 * was without a reader having to join back to `conversations`.
 */
export async function recordAsked(
  client: SupabaseClient,
  assignmentId: string,
  state: ConversationState,
): Promise<void> {
  const { error } = await client.from('assignment_events').insert({
    assignment_id: assignmentId,
    kind: 'asked',
    // 'bot', never 'self' or 'manager'. settle_assignment deliberately cannot
    // produce this value, so nothing a person clicks can be recorded as
    // something the bot concluded, and nothing the bot concludes can be
    // recorded as a person's own report.
    source: 'bot',
    note: `שיחה הסתיימה במצב ${state.outcome} אחרי ${state.interaction} אינטראקציות, מדרגה ${state.rung}`,
  })
  if (error) throw new Error(`רישום השיחה במשימה נכשל: ${error.message}`)
}

/**
 * Phase two, a week later: what actually happened.
 *
 * This is the only path in this system that may settle an assignment, because
 * it is the only one that asks about execution rather than about intent.
 *
 * `partial` settles as `not_done` on purpose. "פעמיים מתוך חמש" is a real and
 * useful answer, and it goes in the note -- but the ask was a daily briefing,
 * and recording a partial as done would let the measurement drift upward one
 * generous rounding at a time. The note is where the nuance lives; the status
 * stays binary so a count of `done` means what it says.
 */
export async function recordExecution(
  client: SupabaseClient,
  assignmentId: string,
  report: { executed: ExecutionReport; timesDone: number | null; whatHappened: string },
): Promise<void> {
  const settled = report.executed === 'yes' ? 'done' : 'not_done'

  const { error: eventError } = await client.from('assignment_events').insert({
    assignment_id: assignmentId,
    kind: settled === 'done' ? 'reported_done' : 'reported_not_done',
    source: 'bot',
    note:
      report.timesDone === null
        ? report.whatHappened
        : `${report.whatHappened} (${report.timesDone} פעמים)`,
  })
  if (eventError) throw new Error(`רישום הביצוע נכשל: ${eventError.message}`)

  // Written directly rather than through settle_assignment, which derives its
  // source from auth.uid() and can only ever produce 'self' or 'manager'. This
  // process runs as service_role with no signed-in user, and a bot-reported
  // execution must not be recorded as either of those.
  //
  // Guarded on status = 'open' so a race with a person's own self-report
  // resolves in the person's favour rather than being overwritten -- the same
  // "a second answer is a second assignment, not an edit of the first" rule
  // settle_assignment enforces on the other side.
  const { error: statusError } = await client
    .from('assignments')
    .update({ status: settled, settled_at: new Date().toISOString() })
    .eq('id', assignmentId)
    .eq('status', 'open')
  if (statusError) throw new Error(`עדכון המשימה נכשל: ${statusError.message}`)
}
