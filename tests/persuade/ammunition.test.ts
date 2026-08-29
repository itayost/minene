import { describe, expect, test, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  CrossTenantError,
  formatAmmunition,
  formatHistory,
  loadAmmunition,
  strengthFromLikePct,
  type Ammunition,
} from '../../src/persuade/engine/ammunition'

const TENANT = '11111111-1111-4111-8111-111111111111'

const makeAmmunition = (overrides: Partial<Ammunition> = {}): Ammunition => ({
  tenantId: TENANT,
  assignment: {
    id: 'a1',
    status: 'open',
    dueOn: null,
    assigneeId: 'p1',
    createdAt: '2026-08-26T09:00:00Z',
  },
  ask: {
    ruleId: 'r1',
    ruleNumber: 1,
    text: 'תדריך של ארבע דקות לפני הפתיחה',
    response: null,
    kind: 'process',
    topicId: 'briefing',
    subTopic: null,
  },
  assignee: { id: 'p1', jobRoleId: 'jr1', jobRoleName: 'מנהל משמרת' },
  arguments: [],
  objections: [],
  howTo: [],
  dosAndDonts: { do: [], dont: [] },
  history: {
    timesAssigned: 1,
    timesDone: 0,
    timesNotDone: 0,
    lastAskedAt: null,
    lastOutcome: null,
  },
  ...overrides,
})

const rpcClient = (data: unknown, error: unknown = null) =>
  ({ rpc: vi.fn(async () => ({ data, error })) }) as unknown as SupabaseClient

describe('loadAmmunition: the tenant check', () => {
  test('refuses a payload belonging to another tenant', async () => {
    // This process holds the SECRET key and bypasses RLS entirely, so the
    // payload's own tenantId is the only thing standing between an assignment id
    // from somewhere it should not have come from and another business's
    // knowledge.
    const client = rpcClient(makeAmmunition({ tenantId: 'a-different-tenant' }))

    await expect(loadAmmunition(client, 'a1', TENANT)).rejects.toBeInstanceOf(CrossTenantError)
  })

  test('returns the payload when the tenant matches', async () => {
    const client = rpcClient(makeAmmunition())

    const result = await loadAmmunition(client, 'a1', TENANT)

    expect(result?.ask.ruleNumber).toBe(1)
  })

  test('a missing or foreign assignment is null, not an error', async () => {
    // The RPC collapses "does not exist" and "not yours" on purpose, so a caller
    // probing ids cannot tell them apart. This layer must not reintroduce the
    // difference.
    expect(await loadAmmunition(rpcClient(null), 'nope', TENANT)).toBeNull()
  })

  test('a database failure raises in Hebrew rather than resolving null', async () => {
    // Null means "no such assignment". A failed read is a different thing and
    // must not be reported as the absence of knowledge.
    await expect(
      loadAmmunition(rpcClient(null, { message: 'connection refused' }), 'a1', TENANT),
    ).rejects.toThrow(/קריאת הידע הארגוני נכשלה/)
  })
})

describe('strengthFromLikePct', () => {
  test('maps the percentage onto the one-to-ten scale', () => {
    expect(strengthFromLikePct(90)).toBe(9)
    expect(strengthFromLikePct(45)).toBe(5)
    expect(strengthFromLikePct(100)).toBe(10)
  })

  test('floors at 1, so a measured 0% stays in the ranking rather than falling out of it', () => {
    // `strength` is constrained to 1-10. A rule everybody disliked is still
    // information and belongs at the bottom, not outside the range.
    expect(strengthFromLikePct(0)).toBe(1)
    expect(strengthFromLikePct(4)).toBe(1)
  })
})

describe('formatAmmunition', () => {
  test('leads with the ask as the business already approved it', () => {
    const text = formatAmmunition(makeAmmunition())

    expect(text).toContain('חוק 1: תדריך של ארבע דקות לפני הפתיחה')
  })

  test('quotes the evidence sentence beside a rated argument', () => {
    const text = formatAmmunition(
      makeAmmunition({
        arguments: [
          {
            ruleId: 'r2',
            ruleNumber: 2,
            text: 'צוות שיודע מוכר יותר',
            subTopic: null,
            likePct: 90,
            voteCount: 20,
            evidence: '18 מתוך 20 עובדים שדירגו את החוק הזה אמרו שהוא עובד',
          },
        ],
      }),
    )

    expect(text).toContain('[חוק 2] צוות שיודע מוכר יותר — 18 מתוך 20')
  })

  test('marks an unrated argument as unrated rather than leaving it looking measured', () => {
    const text = formatAmmunition(
      makeAmmunition({
        arguments: [
          {
            ruleId: 'r3',
            ruleNumber: 3,
            text: 'טיעון חדש',
            subTopic: null,
            likePct: null,
            voteCount: 0,
            evidence: null,
          },
        ],
      }),
    )

    expect(text).toContain('טרם דורג')
  })

  test('omits an empty section entirely rather than rendering an empty heading', () => {
    // A heading followed by silence reads as "nothing here is worth using",
    // which is a weaker instruction than not raising the subject at all.
    const text = formatAmmunition(makeAmmunition())

    expect(text).not.toContain('מקרים שכבר קרו')
    expect(text).not.toContain('איך עושים את זה בפועל')
    expect(text).not.toContain('עשה ואל תעשה')
  })

  test('renders objections in the same if-then shape the prompt already uses for them', () => {
    const text = formatAmmunition(
      makeAmmunition({
        objections: [
          { situation: 'אין לי זמן', response: 'ארבע דקות זה עשרים בשבוע', likePct: 80 },
        ],
      }),
    )

    expect(text).toContain('אם יאמר "אין לי זמן" -> ארבע דקות זה עשרים בשבוע')
  })

  test('tells the model to stop persuading when the blocker is how, not why', () => {
    const text = formatAmmunition(
      makeAmmunition({
        howTo: [{ ruleNumber: 6, text: 'לפתוח בשאלה ולא בהרצאה', likePct: 70, voteCount: 10 }],
      }),
    )

    expect(text).toContain('מפסיקים לשכנע')
  })

  test('names the job role, which is what narrows the do/dont list', () => {
    expect(formatAmmunition(makeAmmunition())).toContain('מנהל משמרת')
  })
})

describe('formatHistory', () => {
  test('says a first ask is a first ask', () => {
    expect(
      formatHistory({
        timesAssigned: 1,
        timesDone: 0,
        timesNotDone: 0,
        lastAskedAt: null,
        lastOutcome: null,
      }),
    ).toBe('זו הפעם הראשונה שמבקשים ממנו את זה.')
  })

  test('counts previous asks, excluding the current one', () => {
    // timesAssigned includes the open assignment being prepared for, so a third
    // ask has two before it.
    const text = formatHistory({
      timesAssigned: 3,
      timesDone: 1,
      timesNotDone: 1,
      lastAskedAt: '2026-08-19T09:00:00Z',
      lastOutcome: 'agreed',
    })

    expect(text).toContain('ביקשו ממנו את זה 2 פעמים קודם')
  })

  test('states the repeated-no-action blocker instead of leaving it to be inferred', () => {
    // The engine's own rule for this blocker is "לא לחזור על אותו טיעון בפעם
    // הרביעית", and a model given only the counts reliably does exactly that.
    const text = formatHistory({
      timesAssigned: 4,
      timesDone: 0,
      timesNotDone: 3,
      lastAskedAt: '2026-08-19T09:00:00Z',
      lastOutcome: 'refused',
    })

    expect(text).toContain('אל תחזור על אותו טיעון')
    expect(text).toContain('בקרה')
  })

  test('separates "said yes and did not do it" from "said no", because they need different moves', () => {
    const text = formatHistory({
      timesAssigned: 2,
      timesDone: 0,
      timesNotDone: 1,
      lastAskedAt: '2026-08-19T09:00:00Z',
      lastOutcome: 'agreed',
    })

    expect(text).toContain('אמר כן ולא עשה')
    expect(text).toContain('הסכמה היא לא ביצוע')
  })
})
