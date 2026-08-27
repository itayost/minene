import { supabase, isStorageConfigured } from './supabase';

/**
 * Who is asking.
 *
 * This app had no authentication at all: the tenant came from
 * `PERSUADER_TENANT_ID` and a caller could name any assignment inside it. That
 * was survivable while it was one owner on a laptop and stopped being
 * survivable the moment eran-task's browser started calling these routes on
 * behalf of shop-floor staff.
 *
 * The token is the one eran-task already issues -- the same Supabase session
 * its own pages use -- so nobody signs in twice and there is no second
 * identity system to keep in step.
 */

export interface Caller {
  userId: string;
  tenantId: string;
  /** 'owner' | 'staff' -- the permissions level, not the job role. */
  role: string;
  jobRoleId: string | null;
  displayName: string | null;
}

/**
 * Deliberately resolves `null` for every failure rather than throwing, and
 * never says which failure it was.
 *
 * Identical in shape and reasoning to `resolveCaller` in eran-task's own Edge
 * Functions: a caller probing this endpoint learns "not authorized" and nothing
 * else -- not whether the token was malformed, expired, or belonged to somebody
 * with no profile row.
 */
export async function resolveCaller(authorization: string): Promise<Caller | null> {
  try {
    if (!isStorageConfigured()) return null;

    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;

    const client = supabase();
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;

    // A profile row is what carries the tenant. An auth.users row without one
    // resolves to no tenant, and is therefore refused rather than defaulted --
    // the same reason eran-task keeps public signup disabled.
    const { data: profile } = await client
      .from('profiles')
      .select('tenant_id, role, job_role_id, display_name')
      .eq('id', data.user.id)
      .maybeSingle();
    if (!profile) return null;

    return {
      userId: data.user.id,
      tenantId: profile.tenant_id,
      role: profile.role,
      jobRoleId: profile.job_role_id,
      displayName: profile.display_name,
    };
  } catch {
    return null;
  }
}

/**
 * The assignment, if this caller may hold a conversation about it.
 *
 * Runs as service_role and therefore bypasses RLS, so this is the whole check
 * rather than a convenience on top of one -- the same position
 * `extract-rules/core.ts` is in on the other side, and the same shape of answer:
 * a missing assignment and somebody else's assignment are indistinguishable.
 *
 * Both readings are admitted on purpose:
 *
 *   * The **assignee** — the person the bot is talking to, answering for
 *     themselves.
 *   * An **owner of the same tenant** — a manager watching or driving the
 *     conversation, and the only one who can hold one in the simulation lab.
 */
export async function loadActionableAssignment(
  caller: Caller,
  assignmentId: string,
): Promise<{ assigneeId: string } | null> {
  const { data } = await supabase()
    .from('assignments')
    .select('tenant_id, assignee_id')
    .eq('id', assignmentId)
    .maybeSingle();
  if (!data) return null;

  if (data.tenant_id !== caller.tenantId) return null;
  const permitted = data.assignee_id === caller.userId || caller.role === 'owner';
  // The assignee is returned rather than merely checked, because the
  // conversation is evidence about THEM and not about whoever is driving it. A
  // manager watching does not make the run a record of the manager.
  return permitted ? { assigneeId: data.assignee_id } : null;
}
