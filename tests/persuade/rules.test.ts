import { describe, expect, test } from 'vitest'
import { MAX_INTERACTIONS } from '../../src/persuade/engine/knowledge'
import {
  checkTurn,
  containsRequest,
  DEFAULT_RULES,
  detectOutcome,
  fatigueScore,
  initialState,
  isAskPhotographable,
  longSentences,
  nextRung,
  shouldStop,
} from '../../src/persuade/engine/rules'
import type { PersuasionPlan, Rung, Turn } from '../../src/persuade/engine/types'

function targetTurn(text: string): Turn {
  return { role: 'target', text, interaction: 1 }
}

const plan: PersuasionPlan = {
  id: 'briefings',
  topic: 'תדריכי בוקר',
  ask: {
    what: 'תדריך בוקר של ארבע דקות לעובדות',
    withWhom: 'העובדות במשמרת בוקר',
    durationMinutes: 4,
    frequency: 'כל בוקר',
    when: 'לפני פתיחת החנות',
    script: ['בוחרים שני פריטים', 'מתרגלים משפט מכירה'],
    trialPeriod: 'שבועיים',
    oneLiner: 'כל בוקר תדריך של ארבע דקות עם העובדות על שני פריטים מהקולקציה',
  },
  onBehalfOf: { name: 'אושר', title: 'המשנה למנכ"ל', mandate: 'ביקש לקדם תדריכי בוקר' },
  currentStateQuestions: ['מה אתה עושה היום?', 'כמה פעמים בשבוע?'],
  arguments: [],
  objections: [],
  escalation: [],
  stopPoint: 'אחרי ארבע אינטראקציות',
  successCriteria: 'תדריך מתועד בכל בוקר',
}

describe('fatigue detection', () => {
  test('a short non-committal reply raises fatigue', () => {
    expect(fatigueScore([targetTurn('בסדר')])).toBeGreaterThan(0.5)
  })

  test('an engaged reply keeps fatigue low', () => {
    const score = fatigueScore([
      targetTurn('אני חושבת שזה יכול לעבוד אבל אני צריכה להבין איך משלבים את זה בבוקר עמוס'),
    ])
    expect(score).toBeLessThan(0.3)
  })

  test('shrinking replies are read as losing them', () => {
    const shrinking = fatigueScore([
      targetTurn('תשמע זה נשמע הגיוני אבל יש לי מלא קרטונים והקולקציה החדשה הרגע נכנסה'),
      targetTurn('אני אנסה לראות מתי אפשר'),
      targetTurn('נראה'),
    ])
    expect(shrinking).toBeGreaterThanOrEqual(0.7)
  })
})

describe('outcome detection', () => {
  test('explicit commitment reads as agreed', () => {
    expect(detectOutcome('סגור, אני עושה את זה מחר')).toBe('agreed')
  })

  test('explicit refusal reads as refused', () => {
    expect(detectOutcome('אני לא מסכים לזה')).toBe('refused')
  })

  test('a vague reply is not a yes', () => {
    expect(detectOutcome('נראה, אולי בשבוע הבא')).toBe('open')
  })
})

describe('escalation ladder', () => {
  test('climbs one rung at a time, never jumps', () => {
    let state = { ...initialState(), interaction: 3, rung: 1 as Rung }
    expect(nextRung(state)).toBe(2)
    state = { ...state, rung: 2 as Rung }
    expect(nextRung(state)).toBe(3)
  })

  test('rung cannot outrun the interaction count', () => {
    const state = { ...initialState(), interaction: 0, rung: 1 as Rung }
    expect(nextRung(state)).toBe(1)
  })
})

describe('stop conditions', () => {
  test('stops after the fourth interaction without a decision', () => {
    const state = { ...initialState(), interaction: MAX_INTERACTIONS }
    expect(shouldStop(state, DEFAULT_RULES).stop).toBe(true)
  })

  test('stops on high fatigue', () => {
    const state = { ...initialState(), interaction: 2, fatigue: 0.8 }
    expect(shouldStop(state, DEFAULT_RULES).stop).toBe(true)
  })

  test('keeps going while the conversation is alive', () => {
    const state = { ...initialState(), interaction: 2, fatigue: 0.2 }
    expect(shouldStop(state, DEFAULT_RULES).stop).toBe(false)
  })
})

describe('turn rule checks', () => {
  const greeting = {
    plan,
    state: initialState(),
    rules: DEFAULT_RULES,
    isGreetingTurn: true,
    statesAsk: false,
    argumentsUsed: 0,
    askedForDecision: false,
  }
  const followUp = { ...greeting, isGreetingTurn: false }

  test('flags an opener that never says on whose authority', () => {
    const v = checkTurn('אהלן עדי, רציתי לדבר איתך על תדריך בוקר של ארבע דקות', greeting)
    expect(v.some((x) => x.rule === 'לא הוצגה שליחות')).toBe(true)
  })

  test('the opener may ask how you are', () => {
    const v = checkTurn('אהלן עדי, אני פונה אליך בשם אושר. מה שלומך היום?', greeting)
    expect(v.filter((x) => x.severity === 'critical')).toHaveLength(0)
  })

  test('flags interrogating before the ask is on the table', () => {
    const v = checkTurn('מה את עושה היום כדי להדריך את הצוות שלך?', followUp)
    expect(v.some((x) => x.rule === 'שאלות לפני בקשה')).toBe(true)
  })

  test('questions are fine once the ask has been stated', () => {
    const v = checkTurn('אז זה אפשרי מחר בבוקר?', {
      ...followUp,
      state: { ...initialState(), askStated: true },
    })
    expect(v.some((x) => x.rule === 'שאלות לפני בקשה')).toBe(false)
  })

  test('flags a lecture with too many arguments', () => {
    const v = checkTurn('אהלן, אני פונה בשם אושר.', { ...greeting, argumentsUsed: 4 })
    expect(v.some((x) => x.rule === 'יותר משני טיעונים בבת אחת')).toBe(true)
  })

  test('flags interaction four that does not force a decision', () => {
    const v = checkTurn('בוא נראה איך אפשר למצוא את הזמן.', {
      ...followUp,
      state: { ...initialState(), interaction: 4, askStated: true },
    })
    expect(v.some((x) => x.rule === 'אינטראקציה 4 בלי חתירה להחלטה')).toBe(true)
  })

  test('flags ignoring a counterpart who has gone flat', () => {
    const v = checkTurn('ועוד נקודה חשובה על התהליך.', {
      ...followUp,
      state: { ...initialState(), interaction: 2, fatigue: 0.8, askStated: true },
    })
    expect(v.some((x) => x.rule === 'התעלמות מעייפות שכנוע')).toBe(true)
  })

  test('a clean opener passes', () => {
    const v = checkTurn('אהלן עדי, אני פונה אליך בשם אושר. מה שלומך היום?', greeting)
    expect(v.filter((x) => x.severity === 'critical')).toHaveLength(0)
  })
})

describe('sentence length rule', () => {
  test('catches a sentence over fifteen words', () => {
    const long =
      'אני רוצה להסביר לך בדיוק למה התהליך הזה חשוב לך ולצוות שלך ולחנות כולה ולרשת בטווח הארוך.'
    expect(longSentences(long)).toHaveLength(1)
  })

  test('short sentences pass', () => {
    expect(longSentences('אושר מבקש תדריך בוקר. ארבע דקות. אפשרי?')).toHaveLength(0)
  })
})

describe('photographable ask gate', () => {
  test('a fully specified ask passes', () => {
    expect(isAskPhotographable(plan).ok).toBe(true)
  })

  test('a vague ask is blocked with a list of what is missing', () => {
    const vague: PersuasionPlan = {
      ...plan,
      ask: { ...plan.ask, script: [], frequency: '', trialPeriod: '' },
    }
    const gate = isAskPhotographable(vague)
    expect(gate.ok).toBe(false)
    expect(gate.missing.length).toBeGreaterThanOrEqual(3)
  })
})

describe('message length rule', () => {
  const ctx = {
    plan,
    state: { ...initialState(), askStated: true },
    isGreetingTurn: false,
    statesAsk: false,
    argumentsUsed: 1,
    askedForDecision: false,
  }

  test('a message of legal sentences can still be an illegal speech', () => {
    const speech = Array.from({ length: 12 }, (_, i) => `משפט קצר מספר ${i}.`).join(' ')
    const v = checkTurn(speech, ctx)
    expect(v.some((x) => x.rule.includes('הודעה ארוכה'))).toBe(true)
    expect(v.some((x) => x.rule.includes('משפט ארוך'))).toBe(false)
  })

  test('a short message passes', () => {
    expect(checkTurn('אושר מבקש תדריך בוקר של ארבע דקות. אפשרי?', ctx)).toHaveLength(0)
  })
})

describe('fatigue only counts once persuasion has started', () => {
  test('a terse opening reply does not end the conversation', () => {
    const opening = { ...initialState(), interaction: 0, fatigue: 0.8 }
    expect(shouldStop(opening, DEFAULT_RULES).stop).toBe(false)
  })

  test('the same fatigue after the ask does end it', () => {
    const later = { ...initialState(), interaction: 2, fatigue: 0.8 }
    expect(shouldStop(later, DEFAULT_RULES).stop).toBe(true)
  })
})

describe('fatigue is measured only under persuasion', () => {
  const reply = (text: string, interaction: number): Turn => ({ role: 'target', text, interaction })

  test('a terse answer to the greeting scores nothing', () => {
    expect(fatigueScore([reply('בסדר. מה נסגר?', 0)])).toBe(0)
  })

  test('the same answer after the ask does score', () => {
    expect(fatigueScore([reply('בסדר. מה נסגר?', 1)])).toBeGreaterThan(0.5)
  })

  test('the greeting reply never drags the average down mid-conversation', () => {
    const withGreeting = fatigueScore([
      reply('בסדר', 0),
      reply('נשמע הגיוני, בוא נראה איך משלבים את זה', 1),
    ])
    expect(withGreeting).toBeLessThan(0.3)
  })
})

describe('the ask-before-questions check, when the ask has no long words', () => {
  test('does not silently pass a message that never states the ask', () => {
    // keywords is built from words longer than three characters. An ask like
    // an ask of only short words yields none, hits is 0, and 0 >= Math.min(2, 0)
    // so containsRequest returned true unconditionally and the critical
    // enforceAskBeforeQuestions check never fired for exactly the asks most
    // likely to be vague.
    const plan = { ask: { what: 'תן לי יד' } } as never
    expect(containsRequest('משהו אחר לגמרי', plan)).toBe(false)
  })

  test('still finds the ask when it is stated', () => {
    const plan = { ask: { what: 'לקיים תדריך יומי לצוות' } } as never
    expect(containsRequest('בואי נקיים תדריך יומי לצוות בפתיחה', plan)).toBe(true)
  })
})
