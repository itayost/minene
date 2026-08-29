import { beforeEach, describe, expect, test } from 'vitest'
import type { Turn } from '../../src/persuade/engine/types'
import { createStore, defaultContext, type RunContext } from '../../src/persuade/lib/store'
import { createFakeSupabase } from './fake-supabase'
import { makeRun } from './helpers'

const TENANT = '11111111-1111-4111-8111-111111111111'
const context: RunContext = { tenantId: TENANT, channel: 'simulation' }

const turn = (overrides: Partial<Turn> = {}): Turn => ({
  role: 'persuader',
  text: 'אושר מבקש תדריך בוקר של ארבע דקות. מתחילים מחר?',
  interaction: 1,
  ...overrides,
})

describe('conversation store: round trip', () => {
  test('saves and reads a conversation back', async () => {
    const { client } = createFakeSupabase()
    const store = createStore(client)
    const run = makeRun('11111111-0000-4000-8000-000000000001')

    await store.saveRun(run, context)
    const loaded = await store.getRun(run.id, TENANT)

    expect(loaded?.id).toBe(run.id)
    expect(loaded?.planId).toBe('briefings')
  })

  test('returns null for an unknown id instead of throwing', async () => {
    const { client } = createFakeSupabase()
    expect(await createStore(client).getRun('does-not-exist', TENANT)).toBeNull()
  })

  test('lists conversations newest first', async () => {
    const { client } = createFakeSupabase()
    const store = createStore(client)
    const older = makeRun('11111111-0000-4000-8000-00000000000a', {
      createdAt: '2026-08-19T10:00:00.000Z',
    })
    const newer = makeRun('11111111-0000-4000-8000-00000000000b', {
      createdAt: '2026-08-19T11:00:00.000Z',
    })

    await store.saveRun(older, context)
    await store.saveRun(newer, context)

    expect((await store.listRuns(TENANT)).map((r) => r.id)).toEqual([newer.id, older.id])
  })

  test('a conversation with a person in the seat has no persona', async () => {
    const { client } = createFakeSupabase()
    const store = createStore(client)
    const run = makeRun('11111111-0000-4000-8000-000000000002', { personaId: null, persona: null })

    await store.saveRun(run, context)

    expect((await store.getRun(run.id, TENANT))?.personaId).toBeNull()
  })
})

describe('conversation store: turns', () => {
  test('round-trips a turn without inventing keys the original did not have', async () => {
    // rung, blocker and violations are optional on Turn. Reading them back as
    // explicit nulls would make a loaded Turn unequal to the saved one for
    // anything that spreads it or counts its keys.
    const { client } = createFakeSupabase()
    const store = createStore(client)
    const run = makeRun('11111111-0000-4000-8000-000000000003', { turns: [turn()] })

    await store.saveRun(run, context)
    const loaded = await store.getRun(run.id, TENANT)

    expect(loaded?.turns[0]).toEqual(turn())
  })

  test('keeps rung, blocker and violations when a turn carries them', async () => {
    const { client } = createFakeSupabase()
    const store = createStore(client)
    const rich = turn({
      rung: 3,
      blocker: 'overloaded',
      violations: [{ rule: 'words-per-message', detail: 'ארוך מדי', severity: 'high' }],
    })
    const run = makeRun('11111111-0000-4000-8000-000000000004', { turns: [rich] })

    await store.saveRun(run, context)

    expect((await store.getRun(run.id, TENANT))?.turns[0]).toEqual(rich)
  })

  test('derives run-level violations from the turns rather than storing a second copy', async () => {
    const violation = {
      rule: 'words-per-sentence',
      detail: 'משפט ארוך',
      severity: 'medium' as const,
    }
    const { client } = createFakeSupabase()
    const store = createStore(client)
    const run = makeRun('11111111-0000-4000-8000-000000000005', {
      turns: [turn({ violations: [violation] }), turn({ interaction: 2 })],
      // Deliberately wrong on the way in: the stored value must not be trusted.
      violations: [],
    })

    await store.saveRun(run, context)

    expect((await store.getRun(run.id, TENANT))?.violations).toEqual([violation])
  })

  test('re-saving the same conversation replaces its turns instead of doubling them', async () => {
    // The lab can re-run and re-save one id. An append would silently double
    // every turn, and the conversation would read as twice as long as it was.
    const { client, db } = createFakeSupabase()
    const store = createStore(client)
    const run = makeRun('11111111-0000-4000-8000-000000000006', {
      turns: [turn(), turn({ interaction: 2 })],
    })

    await store.saveRun(run, context)
    await store.saveRun(run, context)

    expect(db.conversation_turns).toHaveLength(2)
    expect(db.conversations).toHaveLength(1)
  })
})

describe('conversation store: what the schema gets', () => {
  test('promotes the outcome out of state, because that is the field the other side groups by', async () => {
    const { client, db } = createFakeSupabase()
    const run = makeRun('11111111-0000-4000-8000-000000000007')

    await createStore(client).saveRun(run, context)

    expect(db.conversations[0]?.outcome).toBe('agreed')
    expect((db.conversations[0]?.state as { outcome: string }).outcome).toBe('agreed')
  })

  test('carries the tenant and the assignment from the context, not from the run', async () => {
    // The engine has no concept of a tenant. Threading one through Run would
    // push tenancy into the whole engine for the benefit of one module at its edge.
    const { client, db } = createFakeSupabase()
    const run = makeRun('11111111-0000-4000-8000-000000000008')

    await createStore(client).saveRun(run, {
      tenantId: TENANT,
      assignmentId: 'assignment-1',
      assigneeId: 'person-1',
      channel: 'in_app',
    })

    expect(db.conversations[0]).toMatchObject({
      tenant_id: TENANT,
      assignment_id: 'assignment-1',
      assignee_id: 'person-1',
      channel: 'in_app',
    })
  })

  test('defaults to the simulation channel, so a lab run is never counted as evidence about a person', async () => {
    const { client, db } = createFakeSupabase()

    await createStore(client).saveRun(makeRun('11111111-0000-4000-8000-000000000009'), {
      tenantId: TENANT,
    })

    expect(db.conversations[0]?.channel).toBe('simulation')
  })

  test('stores the plan, so a conversation can be explained a week later', async () => {
    const { client, db } = createFakeSupabase()
    const run = makeRun('11111111-0000-4000-8000-00000000000c')

    await createStore(client).saveRun(run, context)

    expect((db.conversations[0]?.plan as { id: string }).id).toBe('briefings')
  })
})

describe('conversation store: failures', () => {
  test('a failed write raises in Hebrew rather than resolving quietly', async () => {
    // Both call sites wrap saveRun in .catch(() => undefined) so a storage
    // failure cannot break a live conversation. That is only defensible while
    // this function actually reports the failure to the thing swallowing it.
    const { client, db } = createFakeSupabase()
    db.failNext = 'connection refused'

    await expect(
      createStore(client).saveRun(makeRun('11111111-0000-4000-8000-00000000000d'), context),
    ).rejects.toThrow(/שמירת השיחה נכשלה/)
  })

  test('a read failure returns null rather than throwing, matching the old file store', async () => {
    const { client } = createFakeSupabase()
    expect(await createStore(client).getRun('nope', TENANT)).toBeNull()
  })
})

describe('defaultContext', () => {
  beforeEach(() => {
    delete process.env.PERSUADER_TENANT_ID
  })

  test('refuses to guess a tenant, because every conversation belongs to one business', async () => {
    expect(() => defaultContext()).toThrow(/PERSUADER_TENANT_ID/)
  })

  test('defaults the channel to simulation when nothing says otherwise', async () => {
    process.env.PERSUADER_TENANT_ID = TENANT
    expect(defaultContext()).toEqual({ tenantId: TENANT, channel: 'simulation' })
  })
})

describe('reads under the service key', () => {
  // This client is service_role, which bypasses RLS entirely -- supabase.ts says
  // so in as many words, and notes that loadAmmunition compensates by comparing
  // the tenant itself. These two reads did not, so with the secret key they
  // returned any tenant's conversations to any caller.
  test('getRun returns nothing for a conversation belonging to another tenant', async () => {
    const { client, db } = createFakeSupabase()
    db.conversations.push({
      id: 'c1',
      tenant_id: 'tenant-a',
      started_at: '2026-08-27T10:00:00Z',
      state: { outcome: 'agreed' },
      outcome: 'agreed',
      plan: { id: 'p' },
      persona: null,
    })

    expect(await createStore(client).getRun('c1', 'tenant-b')).toBeNull()
  })

  test('listRuns is scoped to one tenant', async () => {
    const { client, db } = createFakeSupabase()
    db.conversations.push(
      {
        id: 'a',
        tenant_id: 'tenant-a',
        started_at: '2026-08-27T10:00:00Z',
        state: {},
        outcome: 'open',
        plan: { id: 'p' },
        persona: null,
      },
      {
        id: 'b',
        tenant_id: 'tenant-b',
        started_at: '2026-08-27T11:00:00Z',
        state: {},
        outcome: 'open',
        plan: { id: 'p' },
        persona: null,
      },
    )

    const runs = await createStore(client).listRuns('tenant-a')
    expect(runs.map((r) => r.id)).toEqual(['a'])
  })
})
