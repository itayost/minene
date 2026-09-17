import { generateObject } from 'ai'
import { callOptions, model } from '../lib/model'
import { type Ammunition, formatAmmunition, strengthFromLikePct } from './ammunition'
import { ARGUMENT_LABELS, RUNG_LABELS } from './knowledge'
import { normalizeEscalation, planSchema } from './plan-schema'
import type { Argument, PersuasionPlan } from './types'

/**
 * Stage 0. Nothing is said to the counterpart before this exists.
 * "A persuading AI does not start by talking. It starts by preparing."
 */

export interface PrepareInput {
  id: string
  topic: string
  targetDescription: string
  onBehalfOf: { name: string; title: string; mandate: string } | null
  goal: string
  /**
   * What the business already knows about this ask, retrieved from eran-task.
   *
   * Optional, and absent is a real mode rather than a degraded one: the /rules
   * page still drafts a plan from a free-text description, with no assignment
   * and no knowledge base behind it. When it IS present the plan stops being
   * invented and starts being assembled.
   */
  ammunition?: Ammunition | null
}

/**
 * Overwrites `strength` with the measured rating for every argument the model
 * said it took from a rule.
 *
 * Enforced here rather than asked for in the prompt, which is this engine's
 * standing rule: "The rules are enforced in code. Not asked for in a prompt."
 * A model told to copy a number copies it most of the time, and the times it
 * does not are invisible.
 *
 * `why` is rewritten alongside it, because that field's whole job is to say what
 * the score is based on. Leaving the model's reasoning under a number it did not
 * choose would make it a fabricated justification.
 */
export function applyMeasuredStrength(
  args: Argument[],
  ammunition: Ammunition | null | undefined,
): Argument[] {
  if (!ammunition) return args
  // Unnumbered knowledge is excluded from the lookup rather than keyed by null.
  // Nothing can match it -- sourceRuleNumber null short-circuits above -- and a
  // map holding a null key would silently collapse every unnumbered argument
  // from brain2spark's book into one entry.
  const byNumber = new Map(
    ammunition.arguments
      .filter((a): a is typeof a & { ruleNumber: number } => a.ruleNumber !== null)
      .map((a) => [a.ruleNumber, a]),
  )

  return args.map((argument) => {
    const source =
      argument.sourceRuleNumber == null ? undefined : byNumber.get(argument.sourceRuleNumber)
    // An argument the model wrote itself, or one citing a rule that is not in
    // the payload, keeps the model's own estimate. There is nothing better to
    // replace it with, and inventing a neutral score would discard a real
    // judgement in favour of a made-up one.
    if (!source || source.likePct === null) return argument

    return {
      ...argument,
      strength: strengthFromLikePct(source.likePct),
      why: source.evidence ?? argument.why,
    }
  })
}

/**
 * Everything that reaches the returned plan WITHOUT going through the prompt.
 *
 * There is exactly one such path and it is `applyMeasuredStrength`: a rule's
 * measured rating overwrites the model's own score after the fact, deliberately,
 * because "the rules are enforced in code, not asked for in a prompt". So the
 * rating is not in the prompt -- `formatAmmunition` renders each argument with
 * its evidence sentence and not its number -- and a plan cache keyed on the
 * prompt alone would keep serving yesterday's ranking after the floor re-rated
 * a rule. The arguments would be right and their order would be wrong, which is
 * the failure nobody would ever notice.
 *
 * Keyed by ruleNumber because that is what the map in applyMeasuredStrength is
 * keyed by, and sorted because the payload's order is the RPC's business.
 */
export function measuredInputs(input: PrepareInput): string {
  if (!input.ammunition) return ''
  return input.ammunition.arguments
    .map((a) => `${a.ruleNumber}:${a.likePct ?? ''}:${a.evidence ?? ''}`)
    .sort()
    .join('|')
}

/**
 * The exact two strings the planner is handed.
 *
 * Split out of preparePlan so the plan cache can hash its real input. Keyed on
 * a hand-picked list of ammunition fields instead, the cache would serve a
 * stale plan the first time somebody added a section to `formatAmmunition` --
 * and that function has already grown once. Hashing what is actually sent
 * cannot drift, because the thing hashed is the input.
 */
export function preparePrompt(input: PrepareInput): { system: string; prompt: string } {
  const categories = Object.entries(ARGUMENT_LABELS)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ')
  const rungs = Object.entries(RUNG_LABELS)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ')

  // Two genuinely different jobs, so two different instructions rather than one
  // hedged instruction that covers both badly. Without a knowledge base this is
  // a drafting tool and invention is the whole point; with one, invention is the
  // failure mode -- a freshly-imagined argument competes with one the floor has
  // already rated, and the rated one should win.
  const grounding = input.ammunition
    ? `
- הטיעונים כבר קיימים בארגון ומופיעים למטה. השתמש בהם ואל תמציא חדשים כשיש מתאים.
- לכל טיעון שלקחת מחוק, החזר את מספר החוק ב-sourceRuleNumber. לטיעון שניסחת בעצמך החזר null.
- הדירוג של טיעון שנלקח מחוק נקבע מהמדידה בארגון ולא ממך. תן אומדן, הוא יוחלף.
- הבקשה כבר נוסחה ואושרה. אל תנסח אותה מחדש, רק פרק אותה לשדות.`
    : ''

  return {
    system: `אתה מכין שיחת שכנוע לפני שהיא מתחילה. אתה לא כותב את השיחה, אתה כותב את התחמושת.

כללי הכנה:
- הבקשה חייבת להיות "בקשה שאפשר לצלם". אם אי אפשר לראות בעין אם היא קרתה, היא לא מספיק ברורה.
- דרג כל טיעון 1 עד 10 לפי כמה הוא חזק לאדם הספציפי הזה, לא באופן כללי.
- הטיעונים החזקים ביותר צריכים להיות אישיים: כסף, קריירה, מסוגלות, פחות עומס.
- קטגוריות טיעון: ${categories}
- סולם ההסלמה חייב חמש מדרגות בדיוק: ${rungs}
- מדרגה 5 היא שיחה ניהולית, לא איום בפיטורים.
- עברית פשוטה. משפטים קצרים. בלי שפה של יועצים.${grounding}`,
    prompt: `הנושא: ${input.topic}

המטרה שהארגון רוצה להשיג: ${input.goal}

האדם שאיתו נדבר: ${input.targetDescription}

${
  input.onBehalfOf
    ? `הפנייה נעשית בשם ${input.onBehalfOf.name}, ${input.onBehalfOf.title}. המנדט שניתן: ${input.onBehalfOf.mandate}`
    : 'אין סמכות ארגונית מאחורי הפנייה. אל תמציא אחת.'
}

${input.ammunition ? `\n${formatAmmunition(input.ammunition)}\n` : ''}
הכן את תוכנית השכנוע.`,
  }
}

export async function preparePlan(input: PrepareInput): Promise<PersuasionPlan> {
  const { system, prompt } = preparePrompt(input)

  const { object } = await generateObject({
    model: model('planner'),
    schema: planSchema,
    system,
    prompt,
    ...callOptions('planner'),
  })

  return {
    ...object,
    id: input.id,
    onBehalfOf: input.onBehalfOf,
    arguments: applyMeasuredStrength(object.arguments as Argument[], input.ammunition),
    escalation: normalizeEscalation(object.escalation),
  } as PersuasionPlan
}
