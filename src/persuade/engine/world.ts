import type { TargetPersona } from './types'

/**
 * The closed world a simulated conversation happens inside.
 *
 * The persona says who someone is and how they talk. The world says what is
 * true about them right now and why the thing has not happened -- and crucially,
 * it is given to the Employee Simulator and withheld from the Persuasion
 * Engine. The persuader has to find out through the conversation what moves this
 * person, which is the only version of the task that resembles the real one.
 * `tests/persuade/world-isolation.test.ts` enforces the withholding.
 *
 * It replaces a single free-text `hiddenTruth` with dimensions, for two reasons.
 * A structured world keeps the simulator consistent -- asked twice why he has
 * not done it, he gives the same answer instead of inventing a new one. And
 * dimensions enumerate: four hand-written personas is four scenarios, while
 * these dimensions are 162 distinct worlds per persona, generated at no model
 * cost. That was the bottleneck stopping the lab from running continuously.
 */

export type Motivation = 'low' | 'medium' | 'high'
export type Workload = 'light' | 'normal' | 'crushing'

/**
 * Why it has not happened. The single most important hidden fact, and the one
 * the persuader's whole blocker diagnosis exists to uncover.
 */
export type Reason =
  | 'forgot'
  | 'no_time'
  | 'no_value'
  | 'low_confidence'
  | 'disagrees'
  | 'did_partially'

/** What pressure does to them. Not everyone folds, and not everyone digs in. */
export type PressureResponse = 'digs_in' | 'complies_resentfully' | 'withdraws'

/**
 * What it would actually take, as conditions rather than prose.
 *
 * Prose lets the simulator decide by feel, which is how two identical runs end
 * differently and neither is wrong. Conditions make agreement a thing that was
 * or was not earned -- still judged by a model, but judged against a written
 * standard rather than a mood.
 */
export type AgreeCondition =
  | 'acknowledged_the_load'
  | 'personal_benefit_named'
  | 'ask_made_small'
  | 'authority_invoked'
  | 'numbers_shown'
  | 'asked_for_their_way'

export interface WorldState {
  motivation: Motivation
  workload: Workload
  reason: Reason
  pressureResponse: PressureResponse
  /** Minutes left in the shift. Time pressure is a real lever and a real excuse. */
  minutesLeft: number
  /** The specific fact only this person knows, phrased from the reason. */
  hiddenTruth: string
  /** All of these must be met before they agree. */
  agreesWhen: AgreeCondition[]
}

const MOTIVATIONS: Motivation[] = ['low', 'medium', 'high']
const WORKLOADS: Workload[] = ['light', 'normal', 'crushing']
const REASONS: Reason[] = [
  'forgot',
  'no_time',
  'no_value',
  'low_confidence',
  'disagrees',
  'did_partially',
]
const PRESSURE: PressureResponse[] = ['digs_in', 'complies_resentfully', 'withdraws']

/**
 * What each reason actually takes, which is the whole point of the reason
 * existing.
 *
 * This coupling is what makes a generated world coherent rather than random. A
 * person who forgot needs reminding and a small ask; a person who does not see
 * the value needs the value named, and no amount of reminding touches them.
 * Crossing the dimensions freely without this would produce worlds where the
 * winning move has nothing to do with the problem -- and a lab full of those
 * teaches the persuader noise.
 */
const CONDITIONS_BY_REASON: Record<Reason, AgreeCondition[]> = {
  forgot: ['ask_made_small'],
  no_time: ['acknowledged_the_load', 'ask_made_small'],
  no_value: ['personal_benefit_named'],
  low_confidence: ['acknowledged_the_load', 'ask_made_small'],
  disagrees: ['asked_for_their_way'],
  did_partially: ['numbers_shown'],
}

const HIDDEN_TRUTH_BY_REASON: Record<Reason, string> = {
  forgot: 'פשוט שכחת. אין סיבה עמוקה יותר, ולא נעים לך להגיד את זה.',
  no_time: 'הזמן באמת קצר, אבל אם היו מבקשים ממך משהו קטן מספיק היית מוצא אותו.',
  no_value: 'אתה לא חושב שזה עוזר למשהו. לא תגיד את זה ישר, תגיד שאין זמן.',
  low_confidence: 'הזמן הוא לא הבעיה. אתה לא בטוח בעצמך מול הוותיקים ממך ומפחד להיראות מגוחך.',
  disagrees: 'אתה חושב שיש דרך טובה יותר לעשות את זה, ואף אחד לא שאל אותך.',
  did_partially: 'עשית את זה פעם-פעמיים, לא כל יום. אם ישאלו מספר מדויק, תענה נכון.',
}

/** A motivated person under a light load still needs the reason addressed. */
const resistanceFor = (world: WorldState): 1 | 2 | 3 | 4 | 5 => {
  let score = 3
  if (world.motivation === 'low') score += 1
  if (world.motivation === 'high') score -= 1
  if (world.workload === 'crushing') score += 1
  if (world.workload === 'light') score -= 1
  if (world.reason === 'disagrees' || world.reason === 'no_value') score += 1
  return Math.min(5, Math.max(1, score)) as 1 | 2 | 3 | 4 | 5
}

export interface WorldCell {
  motivation: Motivation
  workload: Workload
  reason: Reason
  pressureResponse: PressureResponse
}

/**
 * Every distinct world, enumerated.
 *
 * 3 x 3 x 6 x 3 = 162. Enumerated rather than sampled so coverage is a fact
 * about the queue rather than a hope about a random seed: you can say which
 * cells have been run and which have not.
 */
export function worldCells(): WorldCell[] {
  const cells: WorldCell[] = []
  for (const motivation of MOTIVATIONS) {
    for (const workload of WORKLOADS) {
      for (const reason of REASONS) {
        for (const pressureResponse of PRESSURE) {
          cells.push({ motivation, workload, reason, pressureResponse })
        }
      }
    }
  }
  return cells
}

/** Minutes left, derived from the load rather than rolled, so a cell is reproducible. */
const minutesFor = (workload: Workload): number =>
  workload === 'crushing' ? 20 : workload === 'normal' ? 45 : 90

export function buildWorld(cell: WorldCell): WorldState {
  return {
    ...cell,
    minutesLeft: minutesFor(cell.workload),
    hiddenTruth: HIDDEN_TRUTH_BY_REASON[cell.reason],
    agreesWhen: CONDITIONS_BY_REASON[cell.reason],
  }
}

const MOTIVATION_TEXT: Record<Motivation, string> = {
  low: 'אתה לא ממש בעניין היום. עושה מה שצריך ולא יותר.',
  medium: 'אתה בסדר. לא נלהב, לא מתנגד.',
  high: 'אכפת לך. אתה רוצה לעשות עבודה טובה.',
}

const WORKLOAD_TEXT: Record<Workload, string> = {
  light: 'היום רגוע יחסית.',
  normal: 'יום עבודה רגיל, יש מה לעשות.',
  crushing: 'אתה קבור. אין רגע פנוי ואתה מרגיש את זה.',
}

const PRESSURE_TEXT: Record<PressureResponse, string> = {
  digs_in: 'אם מפעילים עליך לחץ אתה מתעקש יותר, לא פחות.',
  complies_resentfully: 'אם לוחצים אתה מסכים, אבל בלי חשק, ואתה נותן לזה להישמע.',
  withdraws: 'אם לוחצים אתה מתקצר ומתחיל לענות ב"בסדר" ו"נראה".',
}

const CONDITION_TEXT: Record<AgreeCondition, string> = {
  acknowledged_the_load: 'מישהו הכיר בעומס שלך לפני שביקש',
  personal_benefit_named: 'הסבירו לך מה יוצא לך מזה, אישית',
  ask_made_small: 'הבקשה הוקטנה למשהו שאפשר לעשות בלי לתכנן אותו',
  authority_invoked: 'נאמר לך במפורש שזה מה שמצופה בתפקיד',
  numbers_shown: 'הראו לך מספר שסותר את מה שחשבת',
  asked_for_their_way: 'שאלו אותך איך היית עושה את זה',
}

/**
 * The world as the Employee Simulator is told it.
 *
 * Nothing here may ever reach the persuader's prompt. The conditions are listed
 * as a checklist on purpose: "agree once these are true" is a standard the
 * simulator can apply the same way twice, where a paragraph of motivation is a
 * mood it reinterprets every run.
 */
export function describeWorld(world: WorldState): string {
  return `## המצב שלך עכשיו
${MOTIVATION_TEXT[world.motivation]}
${WORKLOAD_TEXT[world.workload]}
נשארו לך ${world.minutesLeft} דקות עד סוף המשמרת.
${PRESSURE_TEXT[world.pressureResponse]}

## האמת שרק אתה יודע
${world.hiddenTruth}
אל תתנדב לספר את זה. אם ישאלו אותך ישירות - תענה נכון.

## מתי אתה מסכים
רק אחרי שכל אלה קרו:
${world.agreesWhen.map((c) => `- ${CONDITION_TEXT[c]}`).join('\n')}
אם כולם קרו - תגיד במפורש "סגור, אני עושה את זה" ותפסיק להתנגד.
אם לא - אל תסכים רק כדי להיות נחמד.`
}

/**
 * The persona as the world leaves it.
 *
 * The world owns the situation, the hidden truth, the agreement condition and
 * the resistance; the persona keeps its name, role and voice. Two things were
 * saying the same thing before, and when they disagreed nothing said which won.
 */
export function personaInWorld(persona: TargetPersona, world: WorldState): TargetPersona {
  return {
    ...persona,
    resistance: resistanceFor(world),
    situation: `${WORKLOAD_TEXT[world.workload]} ${MOTIVATION_TEXT[world.motivation]}`,
    hiddenTruth: world.hiddenTruth,
    agreesWhen: world.agreesWhen.map((c) => CONDITION_TEXT[c]).join('; '),
  }
}

/**
 * Whether a value read back out of jsonb is actually a world.
 *
 * `describeWorld` indexes lookup tables by these fields, and an unknown value
 * produces the string "undefined" inside the simulated employee's prompt --
 * a corrupt run that completes, gets scored, and is stored as evidence. Loud
 * beats silent: the worker fails the job instead.
 */
export function isWorldState(value: unknown): value is WorldState {
  if (!value || typeof value !== 'object') return false
  const w = value as Partial<WorldState>
  return (
    MOTIVATIONS.includes(w.motivation as Motivation) &&
    WORKLOADS.includes(w.workload as Workload) &&
    REASONS.includes(w.reason as Reason) &&
    PRESSURE.includes(w.pressureResponse as PressureResponse) &&
    typeof w.minutesLeft === 'number' &&
    typeof w.hiddenTruth === 'string' &&
    Array.isArray(w.agreesWhen) &&
    w.agreesWhen.every((c) => c in CONDITION_TEXT)
  )
}
