import type { Outcome, RunScore, Turn } from './engine/types'

/**
 * Reading an experiment.
 *
 * Derived from the runs, never stored, for the same reason the bank is: a
 * stored result is a second copy of a fact the simulations already hold, and it
 * starts drifting the moment a run is re-scored or deleted.
 */

export interface ExperimentRun {
  variant: string | null
  outcome: Outcome
  turns: Turn[]
  score: RunScore | null
}

export interface ArmResult {
  variant: string
  runs: number
  agreed: number
  /** Percent of runs that ended in an explicit yes. Null when nothing ran. */
  agreedPct: number | null
  /** Mean grade over runs that were scored. Null when none were. */
  meanGrade: number | null
  /**
   * Mean persuader messages spent before a yes, over agreed runs only.
   *
   * The interesting half of the question. An arm that persuades as often but in
   * fewer messages is better, and an arm that persuades more often by talking
   * twice as long may not be -- the field report that started this was about
   * conversations being too long.
   */
  meanTurnsToYes: number | null
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2))

const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Number(((part / whole) * 100).toFixed(1))

export function compareArms(runs: readonly ExperimentRun[]): ArmResult[] {
  const byVariant = new Map<string, ExperimentRun[]>()
  for (const run of runs) {
    // A run with no variant belongs to no arm. Counting it into one would
    // attribute a one-off hand-started run to a setting it never tested.
    if (!run.variant) continue
    const list = byVariant.get(run.variant) ?? []
    list.push(run)
    byVariant.set(run.variant, list)
  }

  return [...byVariant.entries()]
    .map(([variant, armRuns]) => {
      const agreedRuns = armRuns.filter((r) => r.outcome === 'agreed')
      const grades = armRuns
        .map((r) => r.score?.grade)
        .filter((g): g is number => typeof g === 'number')

      return {
        variant,
        runs: armRuns.length,
        agreed: agreedRuns.length,
        agreedPct: pct(agreedRuns.length, armRuns.length),
        meanGrade: mean(grades),
        meanTurnsToYes: mean(
          agreedRuns.map((r) => r.turns.filter((t) => t.role === 'persuader').length),
        ),
      }
    })
    .sort((a, b) => a.variant.localeCompare(b.variant))
}

/**
 * Whether the comparison is worth reading yet.
 *
 * Not a significance test, and deliberately not dressed as one. It answers the
 * two questions that make a result obviously worthless -- too few runs, or arms
 * of wildly different sizes -- and leaves the statistics to a person who knows
 * which test applies. A number presented as significant when nobody ran a test
 * is worse than no number.
 */
export function readiness(arms: ArmResult[], minRunsPerArm = 10): string[] {
  const warnings: string[] = []

  if (arms.length < 2) {
    warnings.push('פחות משתי זרועות עם תוצאות — אין השוואה')
    return warnings
  }

  for (const arm of arms) {
    if (arm.runs < minRunsPerArm) {
      warnings.push(`${arm.variant}: ${arm.runs} ריצות בלבד (מומלץ ${minRunsPerArm}+)`)
    }
  }

  const sizes = arms.map((a) => a.runs)
  const smallest = Math.min(...sizes)
  const largest = Math.max(...sizes)
  if (smallest > 0 && largest / smallest >= 2) {
    warnings.push(`הזרועות בגדלים שונים מאוד (${smallest} מול ${largest}) — ההשוואה מוטה`)
  }

  return warnings
}
