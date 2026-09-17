import { z } from 'zod'
import type { EscalationStep, Rung } from './types'

/**
 * The shape of a persuasion plan as a model is asked to produce it.
 *
 * Shared by stage 0 (prepare.ts), which builds a plan from a business's
 * knowledge, and by the lab content generator, which builds library plans from
 * role_needs. Split out so the generator does not import the module that reads
 * a tenant's ammunition just to reuse a schema.
 */

export const argumentSchema = z.object({
  id: z.string(),
  category: z.enum([
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
  ]),
  text: z.string().describe('הטיעון עצמו, כפי שייאמר. עברית פשוטה, עד 20 מילים.'),
  strength: z.number().min(1).max(10).describe('כמה חזק הטיעון הזה לאדם הספציפי הזה'),
  why: z.string().describe('למה נתת לו את הציון הזה דווקא לאדם הזה'),
  // Nullable rather than optional: the model must say "this one is mine" out
  // loud instead of leaving the key off, which is indistinguishable from
  // having forgotten it.
  sourceRuleNumber: z
    .number()
    .nullable()
    .describe('מספר החוק שממנו נלקח הטיעון, או null אם ניסחת אותו בעצמך'),
})

export const planSchema = z.object({
  topic: z.string(),
  ask: z.object({
    what: z.string().describe('הפעולה עצמה. קונקרטית. אפשר לצלם אותה.'),
    withWhom: z.string(),
    durationMinutes: z.number().min(1),
    frequency: z.string(),
    when: z.string().describe('נקודת זמן ביום או בשבוע'),
    script: z.array(z.string()).min(1).describe('מה בפועל אומרים או עושים. שאלות או צעדים.'),
    trialPeriod: z.string().describe('לכמה זמן מבקשים לנסות'),
    oneLiner: z.string().describe('הבקשה במשפט אחד שהמשתמש יוכל לחזור עליו'),
  }),
  currentStateQuestions: z
    .array(z.string())
    .min(2)
    .max(4)
    .describe('שאלות לבדיקת המצב הקיים לפני שמציעים דרך חדשה'),
  arguments: z.array(argumentSchema).min(6).max(10),
  objections: z
    .array(z.object({ objection: z.string(), response: z.string() }))
    .min(3)
    .max(6)
    .describe('התנגדויות צפויות ותשובה קצרה לכל אחת'),
  escalation: z.array(z.object({ rung: z.number().min(1).max(5), message: z.string() })).length(5),
  stopPoint: z.string().describe('מתי מפסיקים לשכנע ומה עושים אז'),
  successCriteria: z.string().describe('איך נדע שזה באמת קרה בעולם'),
})

export type GeneratedPlan = z.infer<typeof planSchema>

/**
 * A model asked for rungs 1-5 still occasionally answers 0 or 5.5. Clamped
 * rather than rejected: the ladder's order is what matters, and the validation
 * that follows refuses a ladder that is not exactly 1, 2, 3, 4, 5.
 */
export function normalizeEscalation(
  steps: readonly { rung: number; message: string }[],
): EscalationStep[] {
  return steps.map((step) => ({
    rung: Math.min(Math.max(Math.round(step.rung), 1), 5) as Rung,
    message: step.message,
  }))
}
