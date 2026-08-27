import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from '../lib/model';
import { ARGUMENT_LABELS, RUNG_LABELS } from './knowledge';
import { formatAmmunition, strengthFromLikePct, type Ammunition } from './ammunition';
import type { Argument, PersuasionPlan } from './types';

/**
 * Stage 0. Nothing is said to the counterpart before this exists.
 * "A persuading AI does not start by talking. It starts by preparing."
 */

const argumentSchema = z.object({
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
});

const planSchema = z.object({
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
  escalation: z
    .array(z.object({ rung: z.number().min(1).max(5), message: z.string() }))
    .length(5),
  stopPoint: z.string().describe('מתי מפסיקים לשכנע ומה עושים אז'),
  successCriteria: z.string().describe('איך נדע שזה באמת קרה בעולם'),
});

export interface PrepareInput {
  id: string;
  topic: string;
  targetDescription: string;
  onBehalfOf: { name: string; title: string; mandate: string } | null;
  goal: string;
  /**
   * What the business already knows about this ask, retrieved from eran-task.
   *
   * Optional, and absent is a real mode rather than a degraded one: the /rules
   * page still drafts a plan from a free-text description, with no assignment
   * and no knowledge base behind it. When it IS present the plan stops being
   * invented and starts being assembled.
   */
  ammunition?: Ammunition | null;
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
  if (!ammunition) return args;
  const byNumber = new Map(ammunition.arguments.map((a) => [a.ruleNumber, a]));

  return args.map((argument) => {
    const source = argument.sourceRuleNumber == null ? undefined : byNumber.get(argument.sourceRuleNumber);
    // An argument the model wrote itself, or one citing a rule that is not in
    // the payload, keeps the model's own estimate. There is nothing better to
    // replace it with, and inventing a neutral score would discard a real
    // judgement in favour of a made-up one.
    if (!source || source.likePct === null) return argument;

    return {
      ...argument,
      strength: strengthFromLikePct(source.likePct),
      why: source.evidence ?? argument.why,
    };
  });
}

export async function preparePlan(input: PrepareInput): Promise<PersuasionPlan> {
  const categories = Object.entries(ARGUMENT_LABELS)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ');
  const rungs = Object.entries(RUNG_LABELS)
    .map(([k, v]) => `${k} = ${v}`)
    .join(', ');

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
    : '';

  const { object } = await generateObject({
    model: model('planner'),
    schema: planSchema,
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
  });

  return {
    ...object,
    id: input.id,
    onBehalfOf: input.onBehalfOf,
    arguments: applyMeasuredStrength(object.arguments as Argument[], input.ammunition),
    escalation: object.escalation.map((e) => ({
      rung: Math.min(Math.max(Math.round(e.rung), 1), 5) as 1 | 2 | 3 | 4 | 5,
      message: e.message,
    })),
  } as PersuasionPlan;
}
