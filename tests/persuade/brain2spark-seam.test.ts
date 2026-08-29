/**
 * @vitest-environment node
 *
 * Can the persuader run on knowledge that came from brain2spark?
 *
 * Their book carries a title and a body under a chapter, and nothing else: no
 * ratings, no vote counts, no evidence sentence, no job role, no rule numbers,
 * no do/dont polarity, no case rules. This builds an ammunition payload with
 * every one of those emptied and asks whether a plan still comes out.
 */
import { afterEach, describe, expect, test } from 'vitest'
import type { Ammunition } from '../../src/persuade/engine/ammunition'
import { formatAmmunition } from '../../src/persuade/engine/ammunition'
import { preparePlan, preparePrompt } from '../../src/persuade/engine/prepare'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, TEST_PLAN } from './helpers'

afterEach(() => setModelOverrides({}))

/** Exactly what book_chapters + book_tips can fill, and nothing more. */
const BOOK_SOURCED: Ammunition = {
  tenantId: 't1',
  assignment: {
    id: 'a1',
    status: 'open',
    dueOn: null,
    assigneeId: 'p1',
    createdAt: '2026-08-29T09:00:00Z',
  },
  ask: {
    ruleId: 'book-tip-1',
    ruleNumber: null,
    text: 'לקיים תדריך של ארבע דקות בפתיחת המשמרת',
    response: null,
    kind: 'process',
    topicId: 'store-management-and-daily-routines',
    subTopic: null,
  },
  assignee: { id: 'p1', jobRoleId: null, jobRoleName: null },
  arguments: [
    {
      ruleId: 'b2',
      ruleNumber: null,
      text: 'צוות שיודע מה המטרה מוכר יותר',
      subTopic: null,
      likePct: null,
      voteCount: 0,
      evidence: null,
    },
    {
      ruleId: 'b3',
      ruleNumber: null,
      text: 'פחות שאלות באמצע המשמרת',
      subTopic: null,
      likePct: null,
      voteCount: 0,
      evidence: null,
    },
  ],
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
}

const PLANNER_PAYLOAD = {
  topic: 'תדריכי בוקר',
  ask: { ...TEST_PLAN.ask },
  currentStateQuestions: ['מה קורה עכשיו בבוקר?', 'מי פותח?'],
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
    { objection: 'לא שלי', response: 'זה כן' },
  ],
  escalation: [1, 2, 3, 4, 5].map((rung) => ({ rung, message: `מדרגה ${rung}` })),
  stopPoint: 'אחרי ארבע',
  successCriteria: 'קרה',
}

describe('the ammunition seam, fed only what brain2spark could supply', () => {
  test('renders a prompt without empty headings or broken ratings', () => {
    const text = formatAmmunition(BOOK_SOURCED)

    expect(text).toContain('לקיים תדריך של ארבע דקות')
    expect(text).toContain('טרם דורג')
    // Sections with nothing in them are omitted rather than rendered as a
    // heading over silence -- which reads to a model as "nothing here is worth
    // using", a weaker instruction than not raising the subject.
    expect(text).not.toContain('## מקרים שכבר קרו')
    expect(text).not.toContain('## עשה ואל תעשה')
    expect(text).not.toContain('## התפקיד של מי שמולנו')
    expect(text).not.toContain('null')
    expect(text).not.toContain('undefined')
    // And no fabricated law number. "חוק 12" is a reference a manager can look
    // up; "חוק 0" is not, and it appeared under a heading claiming the business
    // had already approved this.
    expect(text).not.toContain('חוק 0')
    expect(text).not.toMatch(/חוק\s/)
  })

  test('still builds a plan', async () => {
    setModelOverrides({ planner: jsonModel([PLANNER_PAYLOAD]) })

    const plan = await preparePlan({
      id: 'a1',
      topic: BOOK_SOURCED.ask.topicId,
      targetDescription: BOOK_SOURCED.assignee.jobRoleName ?? 'עובדת בצוות',
      onBehalfOf: null,
      goal: BOOK_SOURCED.ask.text,
      ammunition: BOOK_SOURCED,
    })

    expect(plan.arguments).toHaveLength(6)
    expect(plan.escalation).toHaveLength(5)
  })

  test('leaves the model its own ranking when nothing has been rated', async () => {
    setModelOverrides({ planner: jsonModel([PLANNER_PAYLOAD]) })

    const plan = await preparePlan({
      id: 'a1',
      topic: 'x',
      targetDescription: 'עובדת בצוות',
      onBehalfOf: null,
      goal: 'y',
      ammunition: BOOK_SOURCED,
    })

    // applyMeasuredStrength overwrites a score only where a measurement exists.
    // With none, the model's estimate stands rather than collapsing to zero.
    expect(plan.arguments.every((a) => a.strength === 5)).toBe(true)
  })

  test('the plan cache still keys correctly on unrated knowledge', async () => {
    const input = {
      id: 'a1',
      topic: 'x',
      targetDescription: 'עובדת בצוות',
      onBehalfOf: null,
      goal: 'y',
      ammunition: BOOK_SOURCED,
    }
    const { planFingerprint } = await import('../../src/persuade/lib/plans')
    expect(planFingerprint(input)).toBe(planFingerprint({ ...input }))
    expect(preparePrompt(input).prompt).toContain('לקיים תדריך')
  })
})
