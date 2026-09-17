/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test } from 'vitest'
import {
  COMPANY_MANAGEMENT,
  generatePersona,
  generatePlan,
  personaKeyFor,
  personaPrompt,
  planKeyFor,
  planPrompt,
  type RoleNeed,
  requesterFor,
} from '../../src/persuade/lib/lab-generator'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, recordingJsonModel } from './helpers'

afterEach(() => setModelOverrides({}))

const need = (overrides: Partial<RoleNeed> = {}): RoleNeed => ({
  industry: 'retail',
  roleSlug: 'store-manager',
  roleLabel: 'מנהל חנות',
  roleOrder: 4,
  needKey: 'training-motivation',
  needLabel: 'הדרכה ומוטיבציה',
  metaNeed: 'people',
  ...overrides,
})

const argument = (id: string) => ({
  id,
  category: 'personal_benefit',
  text: 'זה חוסך לך זמן בסוף השבוע',
  strength: 7,
  why: 'עמוס',
  sourceRuleNumber: 12,
})

const PLAN_PAYLOAD = {
  topic: 'תדריך בוקר קצר',
  ask: {
    what: 'תדריך של חמש דקות על מוצר אחד',
    withWhom: 'העובדים במשמרת הבוקר',
    durationMinutes: 5,
    frequency: 'כל יום עבודה',
    when: 'לפני הפתיחה',
    script: ['בוחרים מוצר', 'אומרים מה מיוחד בו'],
    trialPeriod: 'שבועיים',
    oneLiner: 'כל בוקר חמש דקות על מוצר אחד',
  },
  currentStateQuestions: ['איך מדריכים היום?', 'כמה פעמים בשבוע?'],
  arguments: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'].map(argument),
  objections: [
    { objection: 'אין זמן', response: 'חמש דקות' },
    { objection: 'הם יודעים', response: 'נבדוק' },
    { objection: 'לא עכשיו', response: 'שבועיים בלבד' },
  ],
  escalation: [
    { rung: 1, message: 'זה בשבילך' },
    { rung: 2, message: 'חמש דקות' },
    { rung: 3, message: 'זה חלק מהתפקיד' },
    { rung: 4, message: 'נבדוק' },
    { rung: 5, message: 'גבול' },
  ],
  stopPoint: 'אחרי ארבע אינטראקציות',
  successCriteria: 'תדריך בעשרה ימים מתוך עשרה',
}

const PERSONA_PAYLOAD = {
  name: 'נועה',
  reliability: 3,
  situation: 'שבוע של ספירת מלאי',
  hiddenTruth: 'עושה תדריך פעם בשבוע',
  motivatedBy: ['הצוות', 'שקט'],
  style: 'קצרה וענייניית',
  agreesWhen: 'הבקשה קטנה ומוכרת בעומס',
}

describe('keys', () => {
  test('are stable and match the database pattern', () => {
    expect(planKeyFor(need())).toBe('gen-retail-store-manager-training-motivation')
    expect(personaKeyFor(need(), 2)).toBe('gen-retail-store-manager-2')
    expect(planKeyFor(need())).toMatch(/^[a-z0-9-]+$/)
  })
})

describe('requesterFor', () => {
  const needs = [
    need({ roleSlug: 'ceo', roleLabel: 'מנכ"ל', roleOrder: 1 }),
    need({ roleSlug: 'area-manager', roleLabel: 'מנהל אזור', roleOrder: 3 }),
    need(),
    need({ industry: 'bank', roleSlug: 'banker', roleLabel: 'בנקאי', roleOrder: 3 }),
  ]

  test('is the role listed one above, in the same industry', () => {
    expect(requesterFor(need(), needs)).toBe('מנהל אזור')
  })

  test('is company management when nothing is listed above', () => {
    expect(requesterFor(needs[0] as RoleNeed, needs)).toBe(COMPANY_MANAGEMENT)
  })

  test('never crosses industries', () => {
    expect(requesterFor(need({ industry: 'bank', roleOrder: 4 }), needs)).toBe('בנקאי')
    expect(requesterFor(need({ industry: 'healthcare', roleOrder: 4 }), needs)).toBe(
      COMPANY_MANAGEMENT,
    )
  })
})

describe('prompts', () => {
  test('the plan prompt names the need, the role and the requester', () => {
    const { prompt } = planPrompt(need(), 'מנהל אזור')
    expect(prompt).toContain('הדרכה ומוטיבציה')
    expect(prompt).toContain('מנהל חנות')
    expect(prompt).toContain('מנהל אזור')
  })

  test('the persona prompt lists the names that are taken', () => {
    const { prompt } = personaPrompt(need(), 1, ['אושר', 'עדי'])
    expect(prompt).toContain('אושר, עדי')
  })
})

describe('generatePlan', () => {
  test('keys the plan, speaks for the requester and never cites a rule', async () => {
    setModelOverrides({ planner: jsonModel([PLAN_PAYLOAD]) })

    const plan = await generatePlan(need(), 'מנהל אזור')

    expect(plan.id).toBe('gen-retail-store-manager-training-motivation')
    expect(plan.onBehalfOf).toEqual({
      name: 'מנהל אזור',
      title: 'מנהל אזור',
      mandate: 'מנהל אזור ביקש לקדם את "הדרכה ומוטיבציה" ואישר לפנות בשמו',
    })
    expect(plan.arguments.every((a) => a.sourceRuleNumber === null)).toBe(true)
    expect(plan.escalation.map((e) => e.rung)).toEqual([1, 2, 3, 4, 5])
    expect(plan.topic).toBe('תדריך בוקר קצר')
  })
})

describe('generatePersona', () => {
  test('the first persona is the easier one and the second the harder', async () => {
    setModelOverrides({ planner: jsonModel([PERSONA_PAYLOAD]) })

    const first = await generatePersona(need(), 1, [])
    const second = await generatePersona(need(), 2, [])

    expect(first).toMatchObject({
      id: 'gen-retail-store-manager-1',
      resistance: 2,
      role: 'מנהל חנות',
    })
    expect(second).toMatchObject({ id: 'gen-retail-store-manager-2', resistance: 4 })
    expect(first.name).toBe('נועה')
  })

  test('the model is told which names it may not use', async () => {
    const { model, prompts } = recordingJsonModel([PERSONA_PAYLOAD])
    setModelOverrides({ planner: model })

    await generatePersona(need(), 1, ['אושר'])

    expect(prompts()[0]).toContain('אושר')
  })
})
