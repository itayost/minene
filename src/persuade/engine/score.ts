import { generateObject } from 'ai'
import { z } from 'zod'
import { model } from '../lib/model'
import { ARGUMENT_LABELS } from './knowledge'
import type { ConversationState, PersuasionPlan, RuleViolation, RunScore, Turn } from './types'
import { recordUsage } from './usage'

/**
 * "Persuasion does not end when I spoke. It ends when I got a clear answer --
 * and it is measured when I checked what actually happened."
 */

const scoreSchema = z.object({
  persuaded: z.enum(['yes', 'no', 'partial']),
  winningArgument: z.string().nullable().describe('הטיעון שבאמת הזיז אותו, אם היה כזה'),
  winningCategory: z
    .enum([
      'personal_benefit',
      'emotional_benefit',
      'career_money',
      'less_work_later',
      'org_benefit',
      'values_culture',
      'role_standard',
      'cost_of_inaction',
      'numbers',
      'social_proof',
      'authority',
    ])
    .nullable(),
  mainObjection: z.string().nullable(),
  whatBrokeIt: z.string().nullable().describe('מה שבר את ההתנגדות'),
  whatFailed: z.string().nullable().describe('מה המשכנע פספס. תהיה חד.'),
  /**
   * 0-100, stated explicitly because the model was reading it two ways.
   *
   * The field was `z.number().min(0).max(100)` with no description and no scale
   * in the prompt, and the judge picked one per run: a conversation that ended
   * in agreement in three messages came back as 8.4 while a deferred one came
   * back as 72. Both are defensible on their own scale and the pair is
   * meaningless, which is worse than either -- `buildDataset` filters on
   * `grade >= 70`, so the scale drift was quietly rejecting the successful runs
   * and keeping nothing.
   *
   * Integer for the same reason: 8.4 is a tell that a 0-10 scale was in use, and
   * a whole number on 0-100 removes the ambiguity rather than documenting it.
   */
  grade: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe('ציון כולל לשיחה בסולם 0 עד 100, כאשר 100 מצוין. לא בסולם 0-10.'),
  notes: z.string().describe('שתיים עד שלוש שורות. עברית פשוטה.'),
})

export async function scoreRun(
  plan: PersuasionPlan,
  turns: Turn[],
  state: ConversationState,
  violations: RuleViolation[],
): Promise<RunScore> {
  const transcript = turns
    .map((t) => `${t.role === 'persuader' ? 'משכנע' : 'נמען'}: ${t.text}`)
    .join('\n')

  const violationList = violations.length
    ? violations.map((v) => `- [${v.severity}] ${v.rule}: ${v.detail}`).join('\n')
    : 'אין הפרות חוקים שזוהו אוטומטית.'

  const { object, usage } = await generateObject({
    // Variants were removed from the engine after this file was parked, so the
    // judge is the registry's own rather than one carried per run.
    model: model('judge'),
    schema: scoreSchema,
    system: `אתה בודק שיחת שכנוע ונותן ציון בסולם 0 עד 100. אתה קשוח והוגן.

הסולם הוא 0 עד 100 ולא 0 עד 10. שיחה שהסתיימה בהסכמה מפורשת ובמעט הודעות
היא ציון גבוה, לא נמוך.

הציון יורד על:
- לא הוצגה השליחות בפתיחה.
- שאלות לפני שהבקשה נאמרה.
- בקשה כללית שאי אפשר לצלם ("תשקיע יותר בשימור עובדים" זה ציון נכשל).
- הרצאה במקום שיחה. יותר משני טיעונים בהודעה.
- התחלה באינטרס הארגון במקום באינטרס האישי.
- יותר מארבע אינטראקציות בלי החלטה.
- התעלמות מסימני עייפות.
- סיום ב"נראה" או "אשתדל" במקום כן או לא.

הציון עולה על:
- בקשה מדויקת שאפשר לצלם: מה, עם מי, כמה זמן, מתי, מה אומרים, לכמה זמן.
- תועלת אישית חזקה שנאמרה מוקדם.
- זיהוי נכון של החסם האמיתי ולא של מה שנאמר.
- מעבר מהיר ממה ל"איך" ברגע שההתנגדות נשברה.
- סגירה בהחלטה ברורה ובמעקב.`,
    prompt: `הבקשה שהיה צריך להשיג:
${plan.ask.oneLiner}

התמלול:
${transcript}

מצב סופי: ${state.outcome}, ${state.interaction} אינטראקציות, מדד עייפות ${state.fatigue}.

הפרות חוקים שזוהו אוטומטית:
${violationList}

קטגוריות טיעון: ${Object.entries(ARGUMENT_LABELS)
      .map(([k, v]) => `${k}=${v}`)
      .join(', ')}

תן ציון וניתוח.`,
  })

  recordUsage('judge', usage)

  return { ...object, interactionsUsed: state.interaction }
}
