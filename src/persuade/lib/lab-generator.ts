import { generateObject } from 'ai'
import { z } from 'zod'
import { RUNG_LABELS } from '../engine/knowledge'
import { normalizeEscalation, planSchema } from '../engine/plan-schema'
import type { Argument, PersuasionPlan, TargetPersona } from '../engine/types'
import { callOptions, model } from './model'

/**
 * Writes the lab's library plans and personas from role_needs.
 *
 * role_needs describes roles, not people or businesses, which is what makes it
 * a safe source: nothing generated here can carry one business's knowledge into
 * the matrix every business reads. This file takes its inputs as arguments and
 * reads nothing itself.
 */

export interface RoleRef {
  industry: string
  roleSlug: string
  roleLabel: string
  roleOrder: number
}

export interface RoleNeed extends RoleRef {
  needKey: string
  needLabel: string
  metaNeed: string
}

export const COMPANY_MANAGEMENT = 'הנהלת החברה'

export const planKeyFor = (need: RoleNeed): string =>
  `gen-${need.industry}-${need.roleSlug}-${need.needKey}`

export const personaKeyFor = (role: RoleRef, index: 1 | 2): string =>
  `gen-${role.industry}-${role.roleSlug}-${index}`

/**
 * Who asks. role_order is a listing order, not a reporting tree, so "one above"
 * is a stand-in for seniority rather than a claim about who manages whom. It is
 * never a person's name: a named requester would be a name some persona could
 * later be given.
 */
export function requesterFor(need: RoleNeed, needs: readonly RoleNeed[]): string {
  const above = needs.find(
    (other) => other.industry === need.industry && other.roleOrder === need.roleOrder - 1,
  )
  return above?.roleLabel ?? COMPANY_MANAGEMENT
}

const ladder = () =>
  Object.entries(RUNG_LABELS)
    .map(([rung, label]) => `${rung}. ${label}`)
    .join('\n')

export function planPrompt(need: RoleNeed, requester: string): { system: string; prompt: string } {
  return {
    system: `אתה מתכנן שיחות שכנוע בעבודה. אתה כותב תוכנית לשיחה קצרה שבה פונים לאדם בתפקיד מסוים ומבקשים ממנו פעולה אחת קטנה וקבועה.

חוקים:
- הבקשה ניתנת לצילום: מה בדיוק עושים, עם מי, כמה דקות, באיזו תדירות, מתי, מה אומרים או עושים בפועל, ולכמה זמן מנסים.
- הבקשה קטנה: עד 15 דקות בכל פעם.
- אל תמציא שם לאדם שפונים אליו ואל תכתוב אף שם של אדם בתוכנית. פנה בלשון ניטרלית.
- הטיעונים מתחילים מהתועלת האישית של מי שפונים אליו, לא מהארגון.
- כל טיעון עד 20 מילים. עברית פשוטה.
- sourceRuleNumber הוא null בכל טיעון.
- סולם ההסלמה הוא חמש מדרגות, לפי הסדר:
${ladder()}`,
    prompt: `ענף: ${need.industry}
התפקיד של מי שפונים אליו: ${need.roleLabel}
הצורך שהבקשה משרתת: ${need.needLabel} (${need.metaNeed})
מי מבקש: ${requester}

כתוב תוכנית שבה ${requester} מבקש מאדם בתפקיד ${need.roleLabel} פעולה אחת שמקדמת את "${need.needLabel}".`,
  }
}

export async function generatePlan(need: RoleNeed, requester: string): Promise<PersuasionPlan> {
  const { system, prompt } = planPrompt(need, requester)
  const { object } = await generateObject({
    model: model('planner'),
    schema: planSchema,
    system,
    prompt,
    ...callOptions('planner'),
  })

  return {
    ...object,
    id: planKeyFor(need),
    onBehalfOf: {
      name: requester,
      title: requester,
      mandate: `${requester} ביקש לקדם את "${need.needLabel}" ואישר לפנות בשמו`,
    },
    // A library plan is not built from any business's rules, whatever the
    // model wrote in the field.
    arguments: object.arguments.map((argument) => ({
      ...argument,
      sourceRuleNumber: null,
    })) as Argument[],
    escalation: normalizeEscalation(object.escalation),
  } as PersuasionPlan
}

export const personaSchema = z.object({
  name: z.string().describe('שם פרטי עברי אחד, בלי שם משפחה'),
  reliability: z.number().int().min(1).max(5).describe('כמה הוא עומד במה שהוא מסכים לו, 1 עד 5'),
  situation: z.string().describe('משפט או שניים על מה שעובר עליו השבוע בעבודה'),
  hiddenTruth: z.string().describe('משהו אמיתי על ההרגלים שלו שהוא לא יגיד מיוזמתו'),
  motivatedBy: z.array(z.string()).min(2).max(4),
  style: z.string().describe('איך הוא מדבר, בכמה מילים'),
  agreesWhen: z.string().describe('באילו תנאים הוא מסכים לבקשה'),
})

export function personaPrompt(
  role: RoleRef,
  index: 1 | 2,
  avoidNames: readonly string[],
): { system: string; prompt: string } {
  return {
    system:
      'אתה כותב דמות של אדם בעבודה לסימולציית שיחה. הדמות מציאותית ולא קריקטורה. עברית פשוטה.',
    prompt: `ענף: ${role.industry}
תפקיד: ${role.roleLabel}
אופי: ${index === 1 ? 'פתוח יחסית, עסוק אבל מוכן לשמוע.' : 'חשדן ועייף מבקשות, צריך סיבה טובה.'}
שמות תפוסים שאסור להשתמש בהם: ${avoidNames.length > 0 ? avoidNames.join(', ') : 'אין'}`,
  }
}

export async function generatePersona(
  role: RoleRef,
  index: 1 | 2,
  avoidNames: readonly string[],
): Promise<TargetPersona> {
  const { system, prompt } = personaPrompt(role, index, avoidNames)
  const { object } = await generateObject({
    model: model('planner'),
    schema: personaSchema,
    system,
    prompt,
    ...callOptions('planner'),
  })

  return {
    id: personaKeyFor(role, index),
    name: object.name.trim(),
    role: role.roleLabel,
    // Worlds replace resistance in every feed run; the split only shows in a
    // run started by hand without one.
    resistance: index === 1 ? 2 : 4,
    reliability: object.reliability as TargetPersona['reliability'],
    situation: object.situation,
    hiddenTruth: object.hiddenTruth,
    motivatedBy: object.motivatedBy,
    style: object.style,
    agreesWhen: object.agreesWhen,
  }
}
