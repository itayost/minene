import type { ArgumentCategory, BlockerId, Rates, Run } from './types'

/**
 * "Persuasion Rate: out of 100 conversations, how many said yes.
 *  Execution Rate: out of 100 who said yes, how many actually did."
 * The denominators differ on purpose and are never merged.
 */

/**
 * Null when the denominator is zero, never 0.
 *
 * A deliberate change from the code this was recovered from, which returned 0:
 * "nobody has agreed yet" and "everybody who agreed failed" are opposite facts,
 * and reporting the first as 0% claims a total failure that has not happened.
 */
function pct(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : Math.round((numerator / denominator) * 100)
}

/** Same rule for an average: no runs is no answer, not zero. */
function avg(total: number, count: number, places: number): number | null {
  return count === 0 ? null : Number((total / count).toFixed(places))
}

function agreedIn(run: Run): boolean {
  return run.state.outcome === 'agreed'
}

/** Partial execution is not success: the model measures whether the agreed thing happened. */
function executedIn(run: Run): boolean {
  // Only 'yes'. A partial settles as not done, or the measurement drifts
  // upward one generous rounding at a time.
  return run.followUp?.report.executed === 'yes'
}

export function computeRates(runs: Run[]): Rates {
  const agreed = runs.filter(agreedIn)
  const executed = agreed.filter(executedIn)

  const categories = new Map<ArgumentCategory, number>()
  for (const run of agreed) {
    const category = run.score?.winningCategory
    if (category) categories.set(category, (categories.get(category) ?? 0) + 1)
  }

  // A run with no persona is a real conversation with a real person, and it has
  // no place in a persona breakdown. personaId became nullable when real
  // conversations landed; dropping the nulls here is what keeps this cut
  // meaning "how each simulated counterpart behaved".
  const personaIds = [...new Set(runs.map((r) => r.personaId))].filter((id): id is string =>
    Boolean(id),
  )
  const byPersona = personaIds.map((personaId) => {
    const mine = runs.filter((r) => r.personaId === personaId)
    const myAgreed = mine.filter(agreedIn)
    return {
      personaId,
      runs: mine.length,
      persuasionRate: pct(myAgreed.length, mine.length),
      executionRate: pct(myAgreed.filter(executedIn).length, myAgreed.length),
    }
  })

  // `overcome` only credits a run when it is the run's SOLE blocker -- see the
  // matching comment on `blockersIn` in bank.ts. `state.blockers` only ever
  // grows, so a run with two diagnosed blockers that ends in agreement gives no
  // evidence pointing at either one specifically.
  const blockers = new Map<BlockerId, { encountered: number; overcome: number }>()
  for (const run of runs) {
    const distinct = [...new Set(run.state.blockers)]
    const unambiguous = agreedIn(run) && distinct.length === 1
    for (const blocker of distinct) {
      const entry = blockers.get(blocker) ?? { encountered: 0, overcome: 0 }
      blockers.set(blocker, {
        encountered: entry.encountered + 1,
        overcome: entry.overcome + (unambiguous ? 1 : 0),
      })
    }
  }

  const violationCounts = new Map<string, number>()
  for (const run of runs) {
    for (const violation of run.violations) {
      violationCounts.set(violation.rule, (violationCounts.get(violation.rule) ?? 0) + 1)
    }
  }

  const totalViolations = runs.reduce((sum, r) => sum + r.violations.length, 0)
  const criticalViolations = runs.reduce(
    (sum, r) => sum + r.violations.filter((v) => v.severity === 'critical').length,
    0,
  )
  const interactionsToYes = agreed.reduce((sum, r) => sum + r.state.interaction, 0)

  return {
    runs: runs.length,
    agreed: agreed.length,
    executed: executed.length,

    persuasionRate: pct(agreed.length, runs.length),
    executionRate: pct(executed.length, agreed.length),
    deliveryRate: pct(executed.length, runs.length),

    avgInteractionsToYes: avg(interactionsToYes, agreed.length, 1),
    violationsPerRun: avg(totalViolations, runs.length, 2),
    criticalViolationsPerRun: avg(criticalViolations, runs.length, 2),

    byArgumentCategory: [...categories.entries()]
      .map(([category, closes]) => ({ category, closes }))
      .sort((a, b) => b.closes - a.closes),
    byPersona,
    byBlocker: [...blockers.entries()]
      .map(([blocker, v]) => ({ blocker, ...v }))
      .sort((a, b) => b.encountered - a.encountered),
    topViolations: [...violationCounts.entries()]
      .map(([rule, count]) => ({ rule, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
  }
}
