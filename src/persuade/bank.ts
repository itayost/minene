import type { ArgumentCategory, BlockerId, Run } from './engine/types'

/**
 * The bank is derived, never stored.
 *
 * A stored bank is a second copy of a fact the runs already hold, and it starts
 * drifting the moment either side changes -- a re-scored run, a deleted
 * simulation, an argument recategorised. This is a query over what actually
 * won, so it cannot disagree with its own evidence.
 */
export type BankEntry = {
  category: ArgumentCategory
  wonCount: number
  /** The sentences themselves. A category names the lever; these are sayable. */
  examples: string[]
}

export type BlockerStat = {
  blocker: BlockerId
  encountered: number
  overcome: number
}

const agreed = (run: Run) => run.state.outcome === 'agreed'

/**
 * Only agreed runs count.
 *
 * The scorer reports which argument moved the person, and in a refusal nothing
 * did -- it names the closest thing to a winner, which is not the same claim.
 * Counting those would turn the bank into a record of what was tried.
 */
export function buildBank(runs: readonly Run[]): BankEntry[] {
  const byCategory = new Map<ArgumentCategory, { wonCount: number; examples: Set<string> }>()

  for (const run of runs) {
    if (!agreed(run)) continue
    const category = run.score?.winningCategory
    if (!category) continue

    const entry = byCategory.get(category) ?? { wonCount: 0, examples: new Set<string>() }
    entry.wonCount += 1
    if (run.score?.winningArgument) entry.examples.add(run.score.winningArgument)
    byCategory.set(category, entry)
  }

  return [...byCategory.entries()]
    .map(([category, { wonCount, examples }]) => ({ category, wonCount, examples: [...examples] }))
    .sort((a, b) => b.wonCount - a.wonCount)
}

/**
 * What stopped the conversations here, and how often it was got past.
 *
 * Counted once per conversation, not once per mention: otherwise one stubborn
 * exchange that circled the same objection five times outvotes five separate
 * conversations, and the ranking measures repetition rather than incidence.
 *
 * `overcome` only credits a run when it is the run's SOLE blocker. `state.blockers`
 * only ever grows -- nothing marks which one a conversation actually turned on --
 * so a run diagnosed with two blockers that ends in agreement has no evidence
 * pointing at either one specifically. Crediting both would state a fact ("this
 * blocker was broken") the run cannot support; the honest answer for an ambiguous
 * run is to leave `overcome` where it was, not to guess with a coin flip that
 * always lands credit.
 */
export function blockersIn(runs: readonly Run[]): BlockerStat[] {
  const stats = new Map<BlockerId, { encountered: number; overcome: number }>()

  for (const run of runs) {
    const distinct = [...new Set(run.state.blockers)]
    const unambiguous = agreed(run) && distinct.length === 1
    for (const blocker of distinct) {
      const entry = stats.get(blocker) ?? { encountered: 0, overcome: 0 }
      stats.set(blocker, {
        encountered: entry.encountered + 1,
        overcome: entry.overcome + (unambiguous ? 1 : 0),
      })
    }
  }

  return [...stats.entries()]
    .map(([blocker, value]) => ({ blocker, ...value }))
    .sort((a, b) => b.encountered - a.encountered)
}
