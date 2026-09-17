import { isAskPhotographable } from '../engine/rules'
import type { PersuasionPlan, TargetPersona } from '../engine/types'

/**
 * What makes a lab plan or persona usable, in one place.
 *
 * These were inline in scripts/validate-lab-content.ts, which checks what is
 * already stored. The generator needs the same rules before it stores anything,
 * and two copies of a validation rule are two rules the day one of them changes.
 */

const NAME_MAX = 60
const ROLE_MAX = 120
const LADDER = JSON.stringify([1, 2, 3, 4, 5])

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Word boundaries matter: "ועדיין" contains "עדי" and is not a name. */
export function mentionsName(text: string, name: string): boolean {
  return new RegExp(`(?<![א-ת])${escapeRegExp(name)}(?![א-ת])`).test(text)
}

export function planProblems(plan: PersuasionPlan, personaNames: readonly string[]): string[] {
  const problems: string[] = []

  const gate = isAskPhotographable(plan)
  if (!gate.ok) problems.push(`הבקשה לא ניתנת לצילום — חסר ${gate.missing.join(', ')}`)

  const rungs = (plan.escalation ?? []).map((step) => step.rung)
  if (JSON.stringify(rungs) !== LADDER) {
    problems.push(`סולם ההסלמה אינו חמש מדרגות (${rungs.join(',') || 'ריק'})`)
  }

  if (!plan.topic?.trim()) problems.push('אין נושא')
  if ((plan.arguments ?? []).length === 0) problems.push('אין טיעונים')

  // A plan naming a persona makes every simulation against a different persona
  // incoherent, and the failure is silent: the bot addresses the wrong person.
  const blob = JSON.stringify(plan)
  for (const name of personaNames) {
    if (name.trim() && mentionsName(blob, name)) {
      problems.push(`התוכנית מזכירה בשמה את הדמות "${name}"`)
    }
  }

  return problems
}

export function personaProblems(
  persona: Pick<
    TargetPersona,
    'name' | 'role' | 'situation' | 'hiddenTruth' | 'style' | 'agreesWhen'
  >,
): string[] {
  const problems: string[] = []
  if (!persona.name?.trim()) problems.push('אין שם')
  else if (persona.name.trim().length > NAME_MAX) problems.push(`השם ארוך מ-${NAME_MAX} תווים`)
  if (!persona.role?.trim()) problems.push('אין תפקיד')
  else if (persona.role.trim().length > ROLE_MAX) problems.push(`התפקיד ארוך מ-${ROLE_MAX} תווים`)
  if (!persona.situation?.trim()) problems.push('אין מצב')
  if (!persona.hiddenTruth?.trim()) problems.push('אין אמת נסתרת')
  if (!persona.style?.trim()) problems.push('אין סגנון דיבור')
  if (!persona.agreesWhen?.trim()) problems.push('לא נאמר מתי מסכימים')
  return problems
}
