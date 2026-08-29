import { afterEach, describe, expect, test } from 'vitest'
import { preparePlan } from '../../src/persuade/engine/prepare'
import { isAskPhotographable } from '../../src/persuade/engine/rules'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, recordingJsonModel } from './helpers'

const planPayload = {
  topic: 'תדריכי בוקר',
  ask: {
    what: 'תדריך בוקר קצר לעובדות',
    withWhom: 'העובדות במשמרת בוקר',
    durationMinutes: 4,
    frequency: 'כל יום עבודה',
    when: 'לפני פתיחת החנות',
    script: ['בוחרים שני פריטים', 'מתרגלים משפט מכירה'],
    trialPeriod: 'שבועיים',
    oneLiner: 'כל בוקר תדריך של ארבע דקות עם העובדות על שני פריטים',
  },
  currentStateQuestions: ['מה את עושה היום?', 'כמה פעמים בשבוע?'],
  arguments: Array.from({ length: 6 }, (_, i) => ({
    id: `a${i}`,
    category: 'personal_benefit',
    text: `טיעון ${i}`,
    strength: 10 - i,
    why: 'שאפתנית',
    sourceRuleNumber: null,
  })),
  objections: [
    { objection: 'אין לי זמן', response: 'ארבע דקות זה עשרים בשבוע' },
    { objection: 'אני כבר עושה', response: 'בוא נספור שבוע' },
    { objection: 'לא יעבוד', response: 'ננסה שבועיים ונראה' },
  ],
  escalation: [1, 2, 3, 4, 5].map((rung) => ({ rung, message: `מדרגה ${rung}` })),
  stopPoint: 'אחרי ארבע אינטראקציות',
  successCriteria: 'תדריך מתועד בכל בוקר',
}

afterEach(() => setModelOverrides({}))

describe('stage 0 preparation', () => {
  const input = {
    id: 'briefings',
    topic: 'תדריכי בוקר',
    goal: 'שכל מנהלת תעשה תדריך יומי',
    targetDescription: 'עדי, מנהלת חנות עמוסה',
    onBehalfOf: { name: 'אושר', title: 'המשנה למנכ"ל', mandate: 'ביקש לקדם' },
  }

  test('carries the mandate through verbatim rather than inventing one', async () => {
    setModelOverrides({ planner: jsonModel([planPayload]) })
    const plan = await preparePlan(input)
    expect(plan.onBehalfOf).toEqual(input.onBehalfOf)
  })

  test('produces an ask that passes the photographable gate', async () => {
    setModelOverrides({ planner: jsonModel([planPayload]) })
    const plan = await preparePlan(input)
    expect(isAskPhotographable(plan).ok).toBe(true)
  })

  test('keeps no authority when none was given', async () => {
    setModelOverrides({ planner: jsonModel([planPayload]) })
    const plan = await preparePlan({ ...input, onBehalfOf: null })
    expect(plan.onBehalfOf).toBeNull()
  })

  test('clamps a stray escalation rung into the one-to-five ladder', async () => {
    setModelOverrides({
      planner: jsonModel([
        {
          ...planPayload,
          escalation: [
            { rung: 1, message: 'a' },
            { rung: 2, message: 'b' },
            { rung: 3, message: 'c' },
            { rung: 4, message: 'd' },
            { rung: 5, message: 'e' },
          ],
        },
      ]),
    })
    const plan = await preparePlan(input)
    expect(plan.escalation.map((e) => e.rung)).toEqual([1, 2, 3, 4, 5])
  })
})

describe('the generated plan carries its identity', () => {
  test('the id comes from the caller, not the model', async () => {
    setModelOverrides({ planner: jsonModel([planPayload]) })
    const plan = await preparePlan({
      id: 'numbers',
      topic: 'x',
      goal: 'y',
      targetDescription: 'z',
      onBehalfOf: null,
    })
    expect(plan.id).toBe('numbers')
  })
})

describe('stage 0 preparation: grounded in the knowledge base', () => {
  const ammunition = {
    tenantId: '11111111-1111-4111-8111-111111111111',
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
    arguments: [
      {
        ruleId: 'r2',
        ruleNumber: 42,
        text: 'צוות שיודע על המוצר מוכר יותר',
        subTopic: null,
        likePct: 90,
        voteCount: 20,
        evidence: '18 מתוך 20 עובדים שדירגו את החוק הזה אמרו שהוא עובד',
      },
      {
        ruleId: 'r3',
        ruleNumber: 43,
        text: 'טיעון חדש שאיש לא דירג',
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

  const groundedInput = {
    id: 'assignment-1',
    topic: 'תדריכי בוקר',
    goal: 'תדריך יומי בכל חנות',
    targetDescription: 'מנהלת משמרת עמוסה',
    onBehalfOf: null,
    ammunition,
  }

  test('replaces the model estimate with the measured rating for a cited rule', async () => {
    // The engine's standing rule is that rules are enforced in code, not asked
    // for in a prompt. A model told to copy a number copies it most of the time,
    // and the times it does not are invisible.
    setModelOverrides({
      planner: jsonModel([
        {
          ...planPayload,
          arguments: planPayload.arguments.map((a, i) => ({
            ...a,
            strength: 2,
            why: 'ניחוש של המודל',
            sourceRuleNumber: i === 0 ? 42 : null,
          })),
        },
      ]),
    })

    const plan = await preparePlan(groundedInput)

    // 90% measured -> 9, not the 2 the model guessed.
    expect(plan.arguments[0]?.strength).toBe(9)
    expect(plan.arguments[0]?.why).toBe('18 מתוך 20 עובדים שדירגו את החוק הזה אמרו שהוא עובד')
  })

  test('leaves the model estimate alone for an argument it wrote itself', async () => {
    // There is nothing better to replace it with, and a neutral score would
    // discard a real judgement in favour of a made-up one.
    setModelOverrides({
      planner: jsonModel([
        {
          ...planPayload,
          arguments: planPayload.arguments.map((a) => ({
            ...a,
            strength: 7,
            why: 'שאפתנית',
            sourceRuleNumber: null,
          })),
        },
      ]),
    })

    const plan = await preparePlan(groundedInput)

    expect(plan.arguments[0]?.strength).toBe(7)
    expect(plan.arguments[0]?.why).toBe('שאפתנית')
  })

  test('leaves the estimate alone for a rule nobody has rated', async () => {
    setModelOverrides({
      planner: jsonModel([
        {
          ...planPayload,
          arguments: planPayload.arguments.map((a) => ({
            ...a,
            strength: 6,
            why: 'הערכה',
            sourceRuleNumber: 43,
          })),
        },
      ]),
    })

    const plan = await preparePlan(groundedInput)

    expect(plan.arguments[0]?.strength).toBe(6)
  })

  test('leaves the estimate alone when the cited rule is not in the payload at all', async () => {
    // A hallucinated rule number must not silently take another rule's score.
    setModelOverrides({
      planner: jsonModel([
        {
          ...planPayload,
          arguments: planPayload.arguments.map((a) => ({
            ...a,
            strength: 8,
            why: 'הערכה',
            sourceRuleNumber: 9999,
          })),
        },
      ]),
    })

    const plan = await preparePlan(groundedInput)

    expect(plan.arguments[0]?.strength).toBe(8)
  })

  test('puts the retrieved knowledge in front of the model', async () => {
    const { model, prompts } = recordingJsonModel([planPayload])
    setModelOverrides({ planner: model })

    await preparePlan(groundedInput)

    expect(prompts()[0]).toContain('צוות שיודע על המוצר מוכר יותר')
    expect(prompts()[0]).toContain('18 מתוך 20')
    expect(prompts()[0]).toContain('מנהל משמרת')
  })

  test('without a knowledge base it still drafts from a description, which is a real mode', async () => {
    // The /rules page has no assignment behind it. Absent ammunition is the
    // drafting tool, not a degraded version of the grounded path.
    const { model, prompts } = recordingJsonModel([planPayload])
    setModelOverrides({ planner: model })

    const plan = await preparePlan({ ...groundedInput, ammunition: null })

    expect(plan.arguments).toHaveLength(6)
    expect(prompts()[0]).not.toContain('צוות שיודע על המוצר מוכר יותר')
  })
})
