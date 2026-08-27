import { resolveCaller, loadActionableAssignment, type Caller } from './caller';
import { defaultContext, type RunContext } from './store';

/**
 * Who may drive a conversation, and on whose behalf.
 *
 * The rule is fail-closed: a deploy that forgets to configure anything refuses
 * every request rather than accepting every one. The local drafting workflow
 * that predates authentication is preserved by an explicit opt-in, not by a
 * default.
 */
const ANONYMOUS_VAR = 'PERSUADER_ALLOW_ANONYMOUS';

/**
 * True only when the operator has said so out loud.
 *
 * This exists because `/rules` is also a drafting tool: describe an ask, get a
 * plan, talk to it yourself with nobody real on the other side. That workflow
 * has no session and no assignment, and predates this app having a login at
 * all.
 *
 * It must never be on in a deploy that shop-floor staff can reach, which is why
 * it is a variable someone had to set rather than "no token, no problem".
 */
export function anonymousAllowed(): boolean {
  return process.env[ANONYMOUS_VAR] === 'true';
}

export type AccessResult =
  | { ok: true; caller: Caller | null; context: RunContext }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Resolves the caller and works out which conversation they are allowed to
 * have.
 *
 * Three outcomes, and the middle one is the point:
 *
 *   1. A signed-in caller naming an assignment they may act on -> a real
 *      conversation, tenant taken from THEIR profile and never from the body.
 *   2. A signed-in caller naming an assignment they may not -> 403, with a
 *      message that does not distinguish "no such assignment" from "not yours".
 *   3. No token -> refused, unless anonymous drafting is explicitly enabled.
 */
export async function resolveAccess(
  authorization: string,
  assignmentId: string | undefined,
): Promise<AccessResult> {
  const caller = await resolveCaller(authorization);

  if (!caller) {
    // An assignment names a real person, so it is never reachable without a
    // session -- not even in anonymous drafting mode.
    if (assignmentId) {
      return { ok: false, status: 401, error: 'צריך להתחבר כדי לנהל שיחה על משימה.' };
    }
    if (!anonymousAllowed()) {
      return { ok: false, status: 401, error: 'צריך להתחבר.' };
    }
    // The drafting path. defaultContext() supplies the configured tenant and
    // marks the run as a simulation, so it can never be counted as evidence
    // about a person.
    return { ok: true, caller: null, context: defaultContext() };
  }

  if (!assignmentId) {
    // Signed in, but talking to a plan rather than about an ask. Still a
    // simulation as far as measurement is concerned -- there is nobody it is
    // evidence about.
    return { ok: true, caller, context: { tenantId: caller.tenantId, channel: 'simulation' } };
  }

  const assignment = await loadActionableAssignment(caller, assignmentId);
  if (!assignment) {
    // "No such assignment" and "not yours" are one answer, so a caller probing
    // ids cannot tell them apart.
    return { ok: false, status: 403, error: 'המשימה לא נמצאה.' };
  }

  return {
    ok: true,
    caller,
    context: {
      // From the caller's own profile. A body-supplied tenant would let any
      // signed-in person name any business.
      tenantId: caller.tenantId,
      assignmentId,
      // The assignment's assignee, not the caller. A manager driving the
      // conversation does not make the run a record of the manager.
      assigneeId: assignment.assigneeId,
      channel: 'in_app',
    },
  };
}
