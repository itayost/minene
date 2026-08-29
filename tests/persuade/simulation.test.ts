import { afterEach, describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { runSimulation } from '../../src/persuade/engine/simulation'
import type { Run } from '../../src/persuade/engine/types'
import { setModelOverrides } from '../../src/persuade/lib/model'
import {
  jsonModel,
  PERSUADER_PAYLOAD,
  scriptedAgreement,
  TEST_PERSONA,
  TEST_PLAN,
  textModel,
} from './helpers'

afterEach(() => setModelOverrides({}))

async function collect(): Promise<Run> {
  let run: Run | null = null
  for await (const event of runSimulation({ plan: TEST_PLAN, persona: TEST_PERSONA })) {
    if (event.type === 'done') run = event.run
  }
  if (!run) throw new Error('simulation produced no run')
  return run
}

describe('bot against bot', () => {
  test('stops as soon as the counterpart commits', async () => {
    setModelOverrides(scriptedAgreement())

    const run = await collect()

    expect(run.state.outcome).toBe('agreed')
    expect(run.turns).toHaveLength(2)
  })

  test('never exceeds the interaction budget', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['אני עמוסה מאוד היום ויש לי מלא קרטונים לפרוק בחנות']),
    })

    const run = await collect()

    expect(run.state.interaction).toBeLessThanOrEqual(DEFAULT_RULES.maxInteractions)
    expect(run.state.outcome).not.toBe('open')
  })

  test('closes early when the counterpart goes flat', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel([
        'תשמע אני מבינה את הרעיון אבל ממש עכשיו זה לא הזמן הכי טוב בשבילי',
        'אני אנסה לראות מתי',
        'בסדר',
      ]),
    })

    const run = await collect()

    expect(run.state.fatigue).toBeGreaterThanOrEqual(DEFAULT_RULES.fatigueThreshold)
    expect(run.state.outcome).toBe('stopped_fatigue')
  })

  test('an explicit refusal ends it too', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['אני לא מסכים לזה']),
    })

    expect((await collect()).state.outcome).toBe('refused')
  })

  test('records rule violations against the transcript', async () => {
    setModelOverrides({
      ...scriptedAgreement(),
      persuader: jsonModel([
        {
          ...PERSUADER_PAYLOAD,
          message: 'אהלן עדי, מה את עושה היום כדי להדריך את הצוות שלך בבוקר?',
          statesIdentity: false,
          statesAsk: false,
          argumentsUsed: 4,
        },
      ]),
    })

    const run = await collect()

    expect(run.violations.length).toBeGreaterThan(0)
    expect(run.violations.some((v) => v.rule === 'לא הוצגה שליחות')).toBe(true)
    expect(run.violations.some((v) => v.rule === 'יותר משני טיעונים בבת אחת')).toBe(true)
  })

  test('records which plan and which counterpart produced it', async () => {
    setModelOverrides(scriptedAgreement())

    const run = await collect()

    expect(run.planId).toBe('briefings')
    expect(run.personaId).toBe('adi')
  })
})
