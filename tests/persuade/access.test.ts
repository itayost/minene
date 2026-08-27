/*
 * The cors suite came out with the module it tested: folding the persuader
 * into minene made this same-origin, so there is no allow-list left to police.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';


describe('access: who may drive a conversation', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.PERSUADER_ALLOW_ANONYMOUS;
    process.env.PERSUADER_TENANT_ID = '11111111-1111-4111-8111-111111111111';
  });

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  const loadAccess = async (caller: unknown, assignment: unknown = null) => {
    vi.doMock('../../src/persuade/lib/caller', () => ({
      resolveCaller: vi.fn(async () => caller),
      loadActionableAssignment: vi.fn(async () => assignment),
    }));
    return import('../../src/persuade/lib/access');
  };

  const CALLER = {
    userId: 'u1',
    tenantId: '22222222-2222-4222-8222-222222222222',
    role: 'staff',
    jobRoleId: null,
    displayName: 'רונה',
  };

  test('refuses an unauthenticated caller by default', async () => {
    // Fail-closed: a deploy that forgets to configure anything refuses.
    const { resolveAccess } = await loadAccess(null);

    expect(await resolveAccess('', undefined)).toMatchObject({ ok: false, status: 401 });
  });

  test('refuses an unauthenticated caller naming an assignment even when drafting is enabled', async () => {
    // An assignment names a real person, so it is never reachable without a
    // session -- not even in anonymous drafting mode.
    process.env.PERSUADER_ALLOW_ANONYMOUS = 'true';
    const { resolveAccess } = await loadAccess(null);

    expect(await resolveAccess('', 'assignment-1')).toMatchObject({ ok: false, status: 401 });
  });

  test('allows anonymous drafting only when explicitly enabled, as a simulation', async () => {
    process.env.PERSUADER_ALLOW_ANONYMOUS = 'true';
    const { resolveAccess } = await loadAccess(null);

    const result = await resolveAccess('', undefined);

    expect(result).toMatchObject({ ok: true, caller: null });
    if (result.ok) expect(result.context.channel).toBe('simulation');
  });

  test('takes the tenant from the caller profile, never from the environment', async () => {
    // PERSUADER_TENANT_ID is set to a different value above; a signed-in
    // caller's own tenant must win.
    const { resolveAccess } = await loadAccess(CALLER, { assigneeId: 'u1' });

    const result = await resolveAccess('Bearer t', 'assignment-1');

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.context.tenantId).toBe(CALLER.tenantId);
  });

  test('records the conversation against the ASSIGNEE, not whoever is driving it', async () => {
    // A manager watching does not make the run a record of the manager.
    const owner = { ...CALLER, userId: 'manager-1', role: 'owner' };
    const { resolveAccess } = await loadAccess(owner, { assigneeId: 'rona-1' });

    const result = await resolveAccess('Bearer t', 'assignment-1');

    if (!result.ok) throw new Error('expected access');
    expect(result.context.assigneeId).toBe('rona-1');
    expect(result.context.channel).toBe('in_app');
  });

  test('refuses an assignment the caller may not act on, without saying which reason', async () => {
    const { resolveAccess } = await loadAccess(CALLER, null);

    expect(await resolveAccess('Bearer t', 'someone-elses')).toMatchObject({
      ok: false, status: 403, error: 'המשימה לא נמצאה.',
    });
  });

  test('a signed-in caller with no assignment is a simulation, not a real conversation', async () => {
    const { resolveAccess } = await loadAccess(CALLER);

    const result = await resolveAccess('Bearer t', undefined);

    if (!result.ok) throw new Error('expected access');
    expect(result.context.channel).toBe('simulation');
    expect(result.context.assignmentId).toBeUndefined();
  });
});

describe('access: when the server cannot check a token at all', () => {
  const env = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.PERSUADER_ALLOW_ANONYMOUS;
  });

  afterEach(() => {
    process.env = { ...env };
    vi.resetModules();
    vi.restoreAllMocks();
  });

  /** What resolveCaller genuinely does with no service key: refuses, silently. */
  const loadAccess = async () => {
    vi.doMock('../../src/persuade/lib/caller', () => ({
      resolveCaller: vi.fn(async () => null),
      loadActionableAssignment: vi.fn(async () => null),
    }));
    return import('../../src/persuade/lib/access');
  };

  test('says the storage is unconfigured rather than that the caller is not signed in', async () => {
    // resolveCaller returns null for every failure and never says which, which
    // is right for a bad token and wrong for a missing service key: the caller
    // is then told "sign in" for a problem no sign-in can fix. It cost a whole
    // wrong diagnosis -- an owner with a fresh session, told their session had
    // expired, on a machine where the server simply had no key to verify it.
    const { resolveAccess } = await loadAccess();
    const result = await resolveAccess('Bearer anything', undefined);

    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(result.ok === false && result.error).toMatch(/SUPABASE_SECRET_KEY/);
  });

  test('still refuses -- an unconfigured server is not an open one', async () => {
    const { resolveAccess } = await loadAccess();

    expect((await resolveAccess('Bearer anything', 'assignment-1')).ok).toBe(false);
  });

  test('a caller with no token is still told to sign in, not blamed on the server', async () => {
    // The distinction is between credentials that cannot be checked and
    // credentials that were never sent. Only the first is the server's fault.
    const { resolveAccess } = await loadAccess();

    expect(await resolveAccess('', undefined)).toMatchObject({ ok: false, status: 401 });
  });
});
