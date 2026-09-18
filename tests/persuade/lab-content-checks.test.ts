import { describe, expect, test } from 'vitest'
import {
  mentionsName,
  personaProblems,
  planProblems,
} from '../../src/persuade/lib/lab-content-checks'
import { TEST_PERSONA, TEST_PLAN } from './helpers'

describe('mentionsName', () => {
  test('matches a standalone Hebrew name and not the same letters inside a word', () => {
    expect(mentionsName('דיברתי עם עדי אתמול', 'עדי')).toBe(true)
    expect(mentionsName('ועדיין לא', 'עדי')).toBe(false)
  })

  test('treats regex characters in a name literally', () => {
    expect(mentionsName('שלום (דנה)', '(דנה)')).toBe(true)
    expect(mentionsName('שלום דנה', 'דנ.')).toBe(false)
  })
})

describe('planProblems', () => {
  test('a complete plan has none', () => {
    expect(planProblems(TEST_PLAN, [])).toEqual([])
  })

  test('a plan that mentions a persona is refused', () => {
    // TEST_PLAN is made on behalf of אושר.
    expect(planProblems(TEST_PLAN, ['אושר'])).toEqual(['התוכנית מזכירה בשמה את הדמות "אושר"'])
  })

  test('an ask that cannot be photographed is refused', () => {
    const plan = { ...TEST_PLAN, ask: { ...TEST_PLAN.ask, when: '', trialPeriod: '' } }
    expect(planProblems(plan, [])).toEqual(['הבקשה לא ניתנת לצילום — חסר מתי, לכמה זמן מנסים'])
  })

  test('a ladder that is not exactly five rungs in order is refused', () => {
    const plan = { ...TEST_PLAN, escalation: TEST_PLAN.escalation.slice(0, 4) }
    expect(planProblems(plan, [])).toEqual(['סולם ההסלמה אינו חמש מדרגות (1,2,3,4)'])
  })

  test('no topic and no arguments are refused', () => {
    const plan = { ...TEST_PLAN, topic: ' ', arguments: [] }
    expect(planProblems(plan, [])).toEqual(['אין נושא', 'אין טיעונים'])
  })
})

describe('personaProblems', () => {
  test('a complete persona has none', () => {
    expect(personaProblems(TEST_PERSONA)).toEqual([])
  })

  test('empty required fields are refused, each named', () => {
    expect(personaProblems({ ...TEST_PERSONA, hiddenTruth: '', agreesWhen: ' ' })).toEqual([
      'אין אמת נסתרת',
      'לא נאמר מתי מסכימים',
    ])
  })

  test('a name longer than the column allows is refused', () => {
    expect(personaProblems({ ...TEST_PERSONA, name: 'א'.repeat(61) })).toEqual([
      'השם ארוך מ-60 תווים',
    ])
  })
})
