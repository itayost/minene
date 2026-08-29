import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * What the business already knows, retrieved for one assignment.
 *
 * The shape is `persuasion_ammunition(assignment_id)`'s payload verbatim, and it is
 * the contract between the two systems. Renaming anything here means renaming it
 * on the other side too, so it is written to mirror the SQL rather than to read
 * nicely as TypeScript.
 *
 * What it deliberately does NOT carry: argument categories, phrasing, or the
 * escalation ladder. That side owns what the business knows and how well it works;
 * this side owns how to say it to this person now.
 */

export interface AmmunitionArgument {
  ruleId: string
  /**
   * Null when the knowledge did not come from a numbered rule.
   *
   * eran-task numbers every rule per tenant, and the number is how a manager
   * refers to one out loud. brain2spark's book has no equivalent -- a book_tip
   * is a title and a body under a chapter -- so a payload sourced from there
   * carries null rather than a fabricated number. See the citation helper below.
   */
  ruleNumber: number | null
  text: string
  subTopic: string | null
  /** Percentage of the people who rated this rule who said it works. Null when nobody has. */
  likePct: number | null
  voteCount: number
  /** A ready-to-quote Hebrew sentence, or null when there is nothing to quote. */
  evidence: string | null
}

export interface Ammunition {
  tenantId: string
  assignment: {
    id: string
    status: string
    dueOn: string | null
    assigneeId: string
    createdAt: string
  }
  ask: {
    ruleId: string
    ruleNumber: number | null
    text: string
    response: string | null
    kind: string
    topicId: string
    subTopic: string | null
  }
  assignee: { id: string; jobRoleId: string | null; jobRoleName: string | null }
  arguments: AmmunitionArgument[]
  objections: { situation: string; response: string; likePct: number | null }[]
  howTo: { ruleNumber: number | null; text: string; likePct: number | null; voteCount: number }[]
  dosAndDonts: {
    do: { ruleNumber: number | null; text: string; likePct: number | null }[]
    dont: { ruleNumber: number | null; text: string; likePct: number | null }[]
  }
  history: {
    timesAssigned: number
    timesDone: number
    timesNotDone: number
    lastAskedAt: string | null
    lastOutcome: string | null
  }
}

export class CrossTenantError extends Error {
  constructor() {
    super('המשימה שייכת לעסק אחר.')
    this.name = 'CrossTenantError'
  }
}

/**
 * `persuasion_ammunition` is `security invoker`, but this process holds the SECRET
 * key and therefore bypasses RLS entirely. The payload returns `tenantId` for
 * exactly that reason and this is the check it exists for -- the same check
 * `extract-rules/core.ts` makes on the other side, and for the same reason: a
 * service-role read with no tenant comparison is a confused deputy waiting for an
 * id from somewhere it should not have come from.
 */
export async function loadAmmunition(
  client: SupabaseClient,
  assignmentId: string,
  expectedTenantId: string,
): Promise<Ammunition | null> {
  const { data, error } = await client.rpc('persuasion_ammunition', {
    p_assignment_id: assignmentId,
  })
  if (error) throw new Error(`קריאת הידע הארגוני נכשלה: ${error.message}`)
  if (!data) return null

  const ammunition = data as Ammunition
  if (ammunition.tenantId !== expectedTenantId) throw new CrossTenantError()
  return ammunition
}

/** `like_pct` is 0-100; `Argument.strength` is 1-10. */
export function strengthFromLikePct(likePct: number): number {
  // Floored at 1, not 0: `strength` is constrained to 1-10, so a rule everybody
  // disliked scores 1 rather than falling out of the range. That is correct
  // rather than generous -- a measured 0% is still information, and it belongs at
  // the bottom of the ranking rather than outside it.
  return Math.min(Math.max(Math.round(likePct / 10), 1), 10)
}

const bullet = (text: string) => `- ${text}`

/**
 * How a piece of knowledge is cited to the model.
 *
 * "חוק 12" is a real reference a manager can look up. "חוק 0" is not, and that
 * is what an unnumbered source used to render as -- a fabricated law number
 * under a heading that tells the model this was already approved by the
 * business. Unnumbered knowledge is cited by its text alone.
 */
const cite = (ruleNumber: number | null, text: string) =>
  ruleNumber === null ? text : `[חוק ${ruleNumber}] ${text}`

const rated = (text: string, likePct: number | null) =>
  bullet(likePct === null ? `${text} (טרם דורג)` : `${text} (${likePct}% מהמדרגים אמרו שזה עובד)`)

/**
 * The retrieved knowledge as prompt text.
 *
 * Every section is omitted when empty rather than rendered as a heading with
 * nothing under it. A heading followed by silence reads to a model as "there is
 * nothing here worth using", which is a different and weaker instruction than not
 * raising the subject at all.
 */
export function formatAmmunition(ammunition: Ammunition): string {
  const sections: string[] = []

  sections.push(`## הבקשה, כפי שהעסק כבר ניסח ואישר אותה
${ammunition.ask.ruleNumber === null ? '' : `חוק ${ammunition.ask.ruleNumber}: `}${ammunition.ask.text}${
  ammunition.ask.response ? `\nהתגובה המומלצת: ${ammunition.ask.response}` : ''
}`)

  if (ammunition.assignee.jobRoleName) {
    sections.push(`## התפקיד של מי שמולנו\n${ammunition.assignee.jobRoleName}`)
  }

  if (ammunition.arguments.length > 0) {
    sections.push(`## טיעונים שכבר קיימים בארגון
השתמש באלה. אל תמציא טיעונים חדשים כשיש כאן מתאים.
${ammunition.arguments
  .map((a) => `- ${cite(a.ruleNumber, a.text)}${a.evidence ? ` — ${a.evidence}` : ' — טרם דורג'}`)
  .join('\n')}`)
  }

  if (ammunition.objections.length > 0) {
    sections.push(`## מקרים שכבר קרו והתגובה שעבדה
${ammunition.objections.map((o) => `- אם יאמר "${o.situation}" -> ${o.response}`).join('\n')}`)
  }

  if (ammunition.howTo.length > 0) {
    sections.push(`## איך עושים את זה בפועל
אם החסם הוא "לא יודע איך", עוברים לאלה ומפסיקים לשכנע.
${ammunition.howTo.map((h) => rated(h.text, h.likePct)).join('\n')}`)
  }

  const { do: dos, dont: donts } = ammunition.dosAndDonts
  if (dos.length > 0 || donts.length > 0) {
    sections.push(`## עשה ואל תעשה לתפקיד הזה
אם החסם הוא הגדרה מעורפלת, מפרקים להתנהגות עם אלה.
${[
  ...dos.map((d) => rated(`עשה: ${d.text}`, d.likePct)),
  ...donts.map((d) => rated(`אל תעשה: ${d.text}`, d.likePct)),
].join('\n')}`)
  }

  sections.push(`## היסטוריה מול האדם הזה\n${formatHistory(ammunition.history)}`)

  return sections.join('\n\n')
}

/**
 * The history sentence, phrased as what it means rather than as counts, because
 * the counts are what the model would otherwise have to interpret -- and the
 * interpretation is the part that decides which blocker it is looking at.
 */
export function formatHistory(history: Ammunition['history']): string {
  // timesAssigned counts the current ask too, so a first ask is 1.
  const previous = history.timesAssigned - 1
  if (previous <= 0) return 'זו הפעם הראשונה שמבקשים ממנו את זה.'

  const lines = [
    `ביקשו ממנו את זה ${previous} פעמים קודם. ביצע ${history.timesDone}, לא ביצע ${history.timesNotDone}.`,
  ]

  // The `repeated_no_action` blocker, stated rather than left to be inferred.
  // Its own rule in the engine's knowledge base is "לא לחזור על אותו טיעון
  // בפעם הרביעית", and a model given only the numbers reliably does exactly that.
  if (history.timesNotDone > 0 && history.timesDone === 0) {
    lines.push(
      'הוא כבר לא ביצע בעבר ולא ביצע אף פעם. אל תחזור על אותו טיעון מהפעם הקודמת. ' +
        'החסם הוא כנראה לא שכנוע אלא ביצוע: בקרה, ציפייה ברורה, והתחייבות מדויקת.',
    )
  }

  if (history.lastOutcome === 'agreed' && history.timesDone === 0) {
    lines.push(
      'בפעם הקודמת הוא אמר כן ולא עשה. הסכמה היא לא ביצוע, ואין טעם לשכנע אותו שוב לאותו דבר.',
    )
  }

  return lines.join(' ')
}
