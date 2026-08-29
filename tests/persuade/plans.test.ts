/**
 * @vitest-environment node
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Ammunition } from '../../src/persuade/engine/ammunition'
import type { PrepareInput } from '../../src/persuade/engine/prepare'
import type { PersuasionPlan } from '../../src/persuade/engine/types'
import { setModelOverrides } from '../../src/persuade/lib/model'
import {
  clearPlanMemory,
  createPlanStore,
  type PlanStore,
  planFingerprint,
  planFor,
} from '../../src/persuade/lib/plans'
import { jsonModel, TEST_AMMUNITION, TEST_PLAN } from './helpers'

/**
 * The plan was being rebuilt on every message.
 *
 * The client sends no plan by design, so the chat route derived one from the
 * ammunition per turn -- a full stage-0 generation on the planner model in front
 * of every single reply, for a plan that was identical each time. That is the
 * larger half of what the field report called "זמן התגובה בלתי אפשרי", and it
 * is what these tests are here to keep fixed.
 */

const PLANNER_PAYLOAD = {
  topic: 'תדריכי בוקר',
  ask: {
    what: TEST_PLAN.ask.what,
    withWhom: TEST_PLAN.ask.withWhom,
    durationMinutes: TEST_PLAN.ask.durationMinutes,
    frequency: TEST_PLAN.ask.frequency,
    when: TEST_PLAN.ask.when,
    script: TEST_PLAN.ask.script,
    trialPeriod: TEST_PLAN.ask.trialPeriod,
    oneLiner: TEST_PLAN.ask.oneLiner,
  },
  currentStateQuestions: ['מה קורה עכשיו בבוקר?', 'מי פותח את המשמרת?'],
  arguments: Array.from({ length: 6 }, (_, i) => ({
    id: `a${i}`,
    category: 'personal_benefit' as const,
    text: `טיעון ${i}`,
    strength: 5,
    why: 'כי כן',
    sourceRuleNumber: null,
  })),
  objections: [
    { objection: 'אין זמן', response: 'ארבע דקות' },
    { objection: 'לא עוזר', response: 'ננסה שבועיים' },
    { objection: 'לא התפקיד שלי', response: 'זה בדיוק התפקיד' },
  ],
  escalation: [1, 2, 3, 4, 5].map((rung) => ({ rung, message: `מדרגה ${rung}` })),
  stopPoint: 'אחרי ארבע אינטראקציות',
  successCriteria: 'התדריך קרה',
}

const INPUT: PrepareInput = {
  id: '11111111-1111-1111-1111-111111111111',
  topic: 'briefing',
  targetDescription: 'אחראית משמרת',
  onBehalfOf: null,
  goal: 'לקיים תדריך של ארבע דקות בפתיחה',
  ammunition: TEST_AMMUNITION,
}

const TENANT = '22222222-2222-2222-2222-222222222222'

/** Counts plan builds, which is the whole point: one per prompt, not one per turn. */
const plannerCalls = () => {
  let calls = 0
  const model = jsonModel([PLANNER_PAYLOAD])
  const wrapped = new Proxy(model, {
    get(target, key, receiver) {
      if (key === 'doGenerate') {
        calls += 1
      }
      return Reflect.get(target, key, receiver) as unknown
    },
  })
  return { model: wrapped, count: () => calls }
}

/** A plan store that records, so a hit and a miss are distinguishable. */
function fakeStore(): PlanStore & {
  reads: number
  writes: number
  rows: Map<string, PersuasionPlan>
} {
  const rows = new Map<string, PersuasionPlan>()
  const store = {
    reads: 0,
    writes: 0,
    rows,
    async read(assignmentId: string, tenantId: string, fingerprint: string) {
      store.reads += 1
      return rows.get(`${tenantId}:${assignmentId}:${fingerprint}`) ?? null
    },
    async write(assignmentId: string, tenantId: string, fingerprint: string, plan: PersuasionPlan) {
      store.writes += 1
      rows.set(`${tenantId}:${assignmentId}:${fingerprint}`, plan)
    },
  }
  return store
}

beforeEach(() => clearPlanMemory())
afterEach(() => {
  setModelOverrides({})
  clearPlanMemory()
})

describe('the fingerprint', () => {
  test('is the same for the same prompt', () => {
    expect(planFingerprint(INPUT)).toBe(planFingerprint({ ...INPUT }))
  })

  test('changes when a rule behind the plan is re-rated', () => {
    /**
     * The case that nearly got away.
     *
     * A rule's measured rating never appears in the planner prompt --
     * formatAmmunition renders each argument with its evidence sentence, not its
     * number -- and it still decides the plan, because applyMeasuredStrength
     * overwrites the model's score with it after the fact. So a fingerprint over
     * the prompt alone hashes identically before and after the floor re-rates a
     * rule, and the cache keeps serving a plan whose arguments are ranked by the
     * old votes. The arguments would all be right and the order would be wrong,
     * which is exactly the kind of wrong nobody reports.
     */
    const rerated: Ammunition = {
      ...TEST_AMMUNITION,
      arguments: TEST_AMMUNITION.arguments.map((argument, index) =>
        index === 0 ? { ...argument, likePct: 91 } : argument,
      ),
    }

    expect(planFingerprint({ ...INPUT, ammunition: rerated })).not.toBe(planFingerprint(INPUT))
  })

  test('changes when the history moves', () => {
    // formatHistory turns the counts into an instruction -- "he already said
    // yes once and did not do it" changes what the plan should argue. A plan
    // built before that must not be served after it.
    const asked: Ammunition = {
      ...TEST_AMMUNITION,
      history: {
        ...TEST_AMMUNITION.history,
        timesAssigned: 3,
        timesNotDone: 2,
        lastOutcome: 'agreed',
      },
    }

    expect(planFingerprint({ ...INPUT, ammunition: asked })).not.toBe(planFingerprint(INPUT))
  })

  test('ignores the assignment id, which the prompt never carries', () => {
    // A second assignment on the same rule for the same role is the same
    // planning problem. It still gets its own row, because the table is keyed by
    // assignment as well -- but the hash itself is over the prompt alone, and
    // saying so here is what stops somebody folding the id in later and quietly
    // halving the hit rate.
    expect(planFingerprint({ ...INPUT, id: 'another-assignment' })).toBe(planFingerprint(INPUT))
  })
})

describe('building a plan', () => {
  test('happens once across five turns of the same conversation', async () => {
    const planner = plannerCalls()
    setModelOverrides({ planner: planner.model })
    const store = fakeStore()

    for (let turn = 0; turn < 5; turn += 1) {
      await planFor(INPUT, store, TENANT)
    }

    // Five messages used to mean five plans. This is the fix, stated as a
    // number, because it is the one that shows up as seconds on a phone.
    expect(planner.count()).toBe(1)
    expect(store.writes).toBe(1)
  })

  test('survives a cold start by reading the row back', async () => {
    const planner = plannerCalls()
    setModelOverrides({ planner: planner.model })
    const store = fakeStore()

    await planFor(INPUT, store, TENANT)
    // A conversation is five requests and nothing promises they land on the
    // same instance, so the memory map alone would rebuild on any of them.
    clearPlanMemory()
    const second = await planFor(INPUT, store, TENANT)

    expect(planner.count()).toBe(1)
    expect(store.reads).toBe(2)
    expect(second.ask.oneLiner).toBe(TEST_PLAN.ask.oneLiner)
  })

  test('does not read the row again once it is in memory', async () => {
    setModelOverrides({ planner: jsonModel([PLANNER_PAYLOAD]) })
    const store = fakeStore()

    await planFor(INPUT, store, TENANT)
    await planFor(INPUT, store, TENANT)

    // One miss, then nothing: the second turn should not cost a round trip to
    // Supabase either.
    expect(store.reads).toBe(1)
  })

  test('never serves one tenant a plan built for another', async () => {
    setModelOverrides({ planner: jsonModel([PLANNER_PAYLOAD]) })
    const store = fakeStore()

    await planFor(INPUT, store, TENANT)
    const other = '33333333-3333-3333-3333-333333333333'
    await planFor(INPUT, store, other)

    // Two rows. The prompt is identical -- the same rule text can exist in two
    // businesses -- and the plan is still that business's own, so the key
    // carries the tenant in memory exactly as the read filters on it in SQL.
    expect(store.rows.size).toBe(2)
  })

  test('builds without caching when there is no assignment behind it', async () => {
    const planner = plannerCalls()
    setModelOverrides({ planner: planner.model })

    // The drafting path on /rules: free text, no assignment, no tenant to scope
    // a row to. It builds every time, which is correct -- there is nothing to
    // key on and the whole point there is to see a new draft.
    await planFor(INPUT, null, null)
    await planFor(INPUT, null, null)

    expect(planner.count()).toBe(2)
  })
})

describe('the store', () => {
  test('scopes the read by tenant, because the secret key bypasses RLS', async () => {
    const filters: Record<string, unknown> = {}
    const client = {
      from: () => ({
        select: () => ({
          eq: function eq(column: string, value: unknown) {
            filters[column] = value
            return this
          },
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
    } as unknown as SupabaseClient

    await createPlanStore(client).read('assignment', TENANT, 'f'.repeat(64))

    // Same reason getRun in store.ts takes a required tenantId: nothing else
    // scopes this read, so it is scoped here or nowhere.
    expect(filters).toEqual({
      tenant_id: TENANT,
      assignment_id: 'assignment',
      fingerprint: 'f'.repeat(64),
    })
  })

  test('a failed read is a miss, not an error', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: function eq() {
            return this
          },
          maybeSingle: async () => ({ data: null, error: { message: 'down' } }),
        }),
      }),
    } as unknown as SupabaseClient

    // A cache is not allowed to break the thing it accelerates. A Supabase
    // outage should cost a plan generation, not the conversation.
    await expect(createPlanStore(client).read('a', TENANT, 'f'.repeat(64))).resolves.toBeNull()
  })

  test('a failed write does not fail the turn holding a good plan', async () => {
    const upsert = vi.fn(async () => ({ error: { message: 'down' } }))
    const client = { from: () => ({ upsert }) } as unknown as SupabaseClient

    await expect(
      createPlanStore(client).write('a', TENANT, 'f'.repeat(64), TEST_PLAN),
    ).resolves.toBeUndefined()
    expect(upsert).toHaveBeenCalled()
  })
})
