import { buildBank } from './bank'
import type { ArgumentCategory, PersuasionPlan, Run } from './engine/types'
import { CATEGORY_LABELS } from './labels'

/**
 * What the persuader was handed, beside what actually worked.
 *
 * Attribution is by category and the screen says so. RunScore.winningArgument
 * is free text the judge wrote; RunScore.winningCategory is a typed enum and
 * every Argument carries one, so the category is the only link back that is
 * true. Two arguments in one category therefore show the same count. Making it
 * sentence-level means handing the judge the argument ids and changing the
 * scoring prompt, which makes new runs incomparable with old ones -- not worth
 * it at 168 runs.
 */

export interface AnnotatedArgument {
  id: string
  category: ArgumentCategory
  categoryLabel: string
  text: string
  /** Wins by this argument's CATEGORY, not by this sentence. */
  categoryWins: number
  /** The sentences that actually won in that category, as the judge recorded them. */
  winningSentences: string[]
}

export interface UnwrittenWin {
  category: ArgumentCategory
  categoryLabel: string
  wonCount: number
  examples: string[]
}

export interface Persuasions {
  arguments: AnnotatedArgument[]
  /** Categories that carried a conversation without appearing in the plan. */
  unwrittenWins: UnwrittenWin[]
  /** Runs carrying a score. A run with none has not lost; it has not been judged. */
  scoredRuns: number
}

export function persuasionsFor(plan: PersuasionPlan | null, runs: readonly Run[]): Persuasions {
  if (!plan) return { arguments: [], unwrittenWins: [], scoredRuns: 0 }

  const bank = buildBank(runs)
  const byCategory = new Map(bank.map((entry) => [entry.category, entry]))
  const written = new Set(plan.arguments.map((argument) => argument.category))

  // A win is "written" if EITHER the plan fetched just now offers it, or the
  // run's own plan did when the run actually happened. `pnpm lab:generate
  // --force` upserts a need's plan in place under the same plan_key, so a
  // category an earlier version offered -- and a run won -- can vanish from
  // `plan` while the run that won it stays in the bank forever. Checking only
  // the live `plan` would relabel that run's genuinely on-plan win as "the
  // persuader improvised and it worked", which is the opposite of what
  // happened; `run.plan` is the snapshot saved alongside the run, so it still
  // answers what was on the table the day it ran.
  const offeredWhenWon = new Set(
    runs
      .filter((run) => run.state.outcome === 'agreed' && run.score?.winningCategory)
      .filter((run) => run.plan?.arguments?.some((a) => a.category === run.score?.winningCategory))
      .map((run) => run.score?.winningCategory as ArgumentCategory),
  )

  return {
    arguments: plan.arguments.map((argument) => {
      const entry = byCategory.get(argument.category)
      return {
        id: argument.id,
        category: argument.category,
        categoryLabel: CATEGORY_LABELS[argument.category],
        text: argument.text,
        categoryWins: entry?.wonCount ?? 0,
        winningSentences: entry?.examples ?? [],
      }
    }),
    unwrittenWins: bank
      .filter((entry) => !written.has(entry.category) && !offeredWhenWon.has(entry.category))
      .map((entry) => ({
        category: entry.category,
        categoryLabel: CATEGORY_LABELS[entry.category],
        wonCount: entry.wonCount,
        examples: entry.examples,
      })),
    scoredRuns: runs.filter((run) => run.score).length,
  }
}
