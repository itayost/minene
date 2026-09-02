import type { ArgumentCategory, Outcome, RunScore, Turn } from './engine/types'
import type { Reason, WorldState } from './engine/world'

/**
 * How well a persuasion technique works, and on whom.
 *
 * "Social proof wins 64% of the time" is nearly useless. "Social proof works on
 * someone who forgot 88% of the time and on someone who disagrees 19%" is a
 * thing you can act on -- it says reach for it here and not there. That slice is
 * the whole reason the lab stores a world.
 *
 * Derived, never stored, exactly as `bank.ts` is: a stored copy would drift the
 * moment a run is re-scored or deleted, and this cannot disagree with its own
 * evidence.
 *
 * What this rates is a TECHNIQUE, not a piece of the business's knowledge. A
 * simulation can support "naming a personal benefit moves people who see no
 * value"; it cannot support "a four-minute briefing is good advice". Those are
 * different claims and only the first is in reach here.
 */

export interface EffectivenessRun {
  outcome: Outcome
  turns: Turn[]
  score: RunScore | null
  world: WorldState | null
  personaId: string | null
  /** Fatigue at the end. The proxy for a reaction that went badly. */
  fatigue: number
  /** The model id per role that produced the run. Null on rows predating it. */
  models?: Record<string, string> | null
}

export interface Slice {
  key: string
  runs: number
  wins: number
  /** Null rather than 0 when nothing ran: no evidence is not evidence of failure. */
  winPct: number | null
}

export interface TechniqueReport {
  category: ArgumentCategory
  /**
   * Runs where the plan OFFERED this technique -- not runs where it was used.
   *
   * The distinction matters and the number would mislead without it. A run
   * records which category won; it does not record which category each message
   * reached for, because the persuader returns `tools` and a blocker rather
   * than a category per turn. So the denominator is "was on the table" and the
   * numerator is "was named as what moved them".
   *
   * That makes this a fair comparison BETWEEN techniques within the same plan,
   * and a poor absolute rate. Making it exact means having the persuader name
   * the category it used each turn, which is a prompt and schema change.
   *
   * One further exclusion: an agreed run the scorer never got to (or that came
   * back with no winning category) is left out of this count entirely, for
   * every category the plan offered. It is not a loss for any of them -- it is
   * a conversation nobody has a verdict on. See `isInformative`.
   *
   * A category the plan never offered can still show up here with `wins`
   * above zero -- the scorer named it anyway, see `categoriesInPlay` -- but it
   * never joins `runs`. A loss can't add an unoffered category to the count
   * (there is no winner to add it), so if a win did, wins and runs would
   * always be equal for that category: a manufactured 100%, not a measured
   * one, and one that only gets harder to spot as it clears the thin-sample
   * warning. `wins` without `runs` is the honest way to say "this happened,
   * but not on a run this technique was actually being tested on".
   */
  runs: number
  wins: number
  winPct: number | null
  /** Persuader messages spent before a yes, over winning runs only. */
  avgMessagesToWin: number | null
  /**
   * Share of runs where the counterpart was worn down rather than persuaded.
   *
   * The metric that stops a technique looking good for the wrong reason: an
   * approach that wins half the time and exhausts the other half is not a
   * fifty percent technique, it is a technique with a cost nobody counted.
   *
   * Carries the same caveat as `runs`, more sharply: exhaustion is a property
   * of the whole conversation, so every technique the plan offered shares the
   * blame. Within one plan this number is therefore identical across
   * categories, and only tells techniques apart across plans that offer
   * different sets.
   */
  negativeReactionPct: number | null
  byReason: Slice[]
  byPersona: Slice[]
}

const pct = (part: number, whole: number): number | null =>
  whole === 0 ? null : Number(((part / whole) * 100).toFixed(1))

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : Number((xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2))

/**
 * A run counts toward a technique when the scorer named it as what moved the
 * person, and only then.
 *
 * The scorer reports a winning category on losses too -- it names the closest
 * thing to a winner, which is a different claim from "this worked". Counting
 * those would make the denominator "times mentioned" and the numerator "times
 * won", which is a ratio of two unrelated things. So a loss contributes to a
 * technique's denominator only through the categories the plan actually offered.
 */
function categoriesInPlay(
  run: EffectivenessRun,
  offered: readonly ArgumentCategory[],
): {
  attempted: ArgumentCategory[]
  won: ArgumentCategory | null
} {
  const won = run.outcome === 'agreed' ? (run.score?.winningCategory ?? null) : null
  // The winner joins the attempted set even when the plan never offered it.
  // Otherwise `won === category` matches nothing, the win is dropped, and the
  // run still lands in every offered technique's denominator -- a conversation
  // that succeeded counted as a loss for everything and a win for nothing.
  // Off-plan winners are real: the scorer picks from the whole category list,
  // not from this plan's arguments.
  const attempted = won && !offered.includes(won) ? [...offered, won] : [...offered]
  return { attempted, won }
}

/**
 * Whether a run says anything at all about which offered category worked.
 *
 * A loss is informative on its own: nothing was named because nothing won,
 * and every offered category shares that loss. An agreement is informative
 * only once a scorer named a winner. Scoring is a separate pass that can fail
 * after the conversation already ended in a yes (see app/api/persuade/
 * simulate/route.ts, which stores the run with `score: null` rather than
 * lose the conversation) -- and a run like that proves nothing about which
 * category moved the person. Folding it in as a loss for every category the
 * plan offered would be the same "0 where the honest answer is null" mistake
 * `pct()` exists to prevent, just reached through the numerator's inputs
 * instead of the ratio itself.
 */
function isInformative(run: EffectivenessRun): boolean {
  return run.outcome !== 'agreed' || run.score?.winningCategory != null
}

function sliceBy<T extends string>(rows: { key: T | null; won: boolean }[]): Slice[] {
  const byKey = new Map<string, { runs: number; wins: number }>()
  for (const row of rows) {
    if (!row.key) continue
    const at = byKey.get(row.key) ?? { runs: 0, wins: 0 }
    at.runs += 1
    if (row.won) at.wins += 1
    byKey.set(row.key, at)
  }
  return [...byKey.entries()]
    .map(([key, v]) => ({ key, runs: v.runs, wins: v.wins, winPct: pct(v.wins, v.runs) }))
    .sort((a, b) => (b.winPct ?? -1) - (a.winPct ?? -1) || a.key.localeCompare(b.key))
}

export interface EffectivenessInput {
  run: EffectivenessRun
  /** The categories this run's plan actually put on the table. */
  offered: ArgumentCategory[]
}

export function buildEffectiveness(inputs: readonly EffectivenessInput[]): TechniqueReport[] {
  const byCategory = new Map<
    ArgumentCategory,
    {
      runs: number
      wins: number
      messages: number[]
      /** Every run that offered this category, informative or not -- the exhaustion denominator. */
      offeredCount: number
      negative: number
      reasons: { key: Reason | null; won: boolean }[]
      personas: { key: string | null; won: boolean }[]
    }
  >()

  for (const { run, offered } of inputs) {
    const { attempted, won } = categoriesInPlay(run, offered)
    const informative = isInformative(run)

    for (const category of new Set(attempted)) {
      const at = byCategory.get(category) ?? {
        runs: 0,
        wins: 0,
        messages: [],
        offeredCount: 0,
        negative: 0,
        reasons: [],
        personas: [],
      }
      const isWin = won === category
      const isOffered = offered.includes(category)
      // An uninformative run (agreed, never scored) sits out the win/loss
      // count entirely -- for every category the plan offered, not just this
      // one, since the run says nothing about any of them.
      if (informative) {
        if (isOffered) {
          at.runs += 1
          if (isWin) {
            at.wins += 1
            at.messages.push(run.turns.filter((t) => t.role === 'persuader').length)
          }
          at.reasons.push({ key: run.world?.reason ?? null, won: isWin })
          at.personas.push({ key: run.personaId, won: isWin })
        } else if (isWin) {
          // categoriesInPlay() puts an off-plan winner here so the win is never
          // silently dropped -- but a LOSS never adds an unoffered category to
          // `attempted` (there is no `won` to add), so an unoffered category
          // only ever shows up on the runs it wins. Letting it join `runs` too
          // would make wins === runs a certainty of the accounting, not a
          // result: a technique the plan has never once deliberately offered
          // would read as a flawless 100%, and stay flawless no matter how
          // many more off-plan wins pile on top -- eventually clearing the
          // thin-sample warning and reading as a real, clean rate. So the win
          // is credited without a matching run, which leaves `runs` at 0 and
          // `winPct` at null: visible, but correctly unrated.
          at.wins += 1
        }
      }
      // Worn down rather than persuaded. Counted per technique that was on the
      // table, because a technique cannot be credited for a win and excused
      // from the exhaustion in the same conversation. Kept on its own
      // denominator (`offeredCount`, every run that offered the category)
      // rather than `runs`: whether the scorer later named a winner has no
      // bearing on whether the conversation wore the person down, so an
      // uninformative run still belongs in this ratio even though it sits out
      // the win rate above.
      //
      // Two signals, not one: `stopped_fatigue` is the engine's own verdict,
      // reached against whatever fatigueThreshold that run's RuleConfig
      // actually used -- which an experiment is free to set below 0.7 (it is
      // an ordinary field on RuleConfig, see experiments.ts). A run that
      // stopped at 0.4 under a lowered threshold is not less worn down than
      // one that reached 0.7 under the default; checking only the fixed bar
      // silently undercounts exactly the runs an experiment on this setting
      // exists to compare. The fixed bar stays, for the case this outcome
      // doesn't cover: an agreed run where fatigue crept high without ever
      // tripping the stop.
      at.offeredCount += 1
      if (run.outcome === 'stopped_fatigue' || run.fatigue >= 0.7) at.negative += 1
      byCategory.set(category, at)
    }
  }

  return [...byCategory.entries()]
    .map(([category, v]) => ({
      category,
      runs: v.runs,
      wins: v.wins,
      winPct: pct(v.wins, v.runs),
      avgMessagesToWin: mean(v.messages),
      negativeReactionPct: pct(v.negative, v.offeredCount),
      byReason: sliceBy(v.reasons),
      byPersona: sliceBy(v.personas),
    }))
    .sort((a, b) => (b.winPct ?? -1) - (a.winPct ?? -1))
}

/**
 * How many distinct persuader-model fingerprints the compared runs carry.
 *
 * A win rate credits the message, and the message came from a specific
 * persuader model as much as from the category it reached for. Pooling runs
 * from two persuader models into one technique's win rate has the same
 * failure shape `experiment-results.ts`'s `readiness` already guards an A/B
 * comparison against -- two arms on different models are two experiments, not
 * one -- so the caller should treat more than one fingerprint here as reason
 * to distrust the comparison the same way.
 */
export function distinctModelFingerprints(inputs: readonly EffectivenessInput[]): number {
  return new Set(inputs.map((i) => JSON.stringify(i.run.models ?? null))).size
}

/**
 * Renders one technique the way the architecture note asked for it.
 *
 * Kept as text rather than a component because the first consumer is a person
 * reading a terminal, and a number nobody has looked at yet does not need a
 * screen built for it.
 */
export function formatTechnique(report: TechniqueReport, minRuns = 10): string {
  const lines = [
    `Rule: ${report.category}`,
    '',
    `Overall success:       ${report.winPct === null ? '-' : `${report.winPct}%`}  (${report.runs} runs)`,
  ]

  if (report.runs < minRuns) {
    lines.push(`  ! only ${report.runs} runs — too few to read`)
  }

  // The same bar the overall figure is checked against, applied per row: an
  // overall count that clears minRuns says nothing about any one slice inside
  // it, and a persona or reason built from a single run can print a 100% that
  // means nothing while sitting unflagged next to rows built from a real
  // sample.
  const thin = (n: number) => (n < minRuns ? ' !' : '')

  if (report.byPersona.length > 0) {
    lines.push('', 'By persona:')
    for (const s of report.byPersona) {
      lines.push(
        `  ${s.key.padEnd(22)} ${s.winPct === null ? '-' : `${s.winPct}%`}  (${s.runs})${thin(s.runs)}`,
      )
    }
  }

  if (report.byReason.length > 0) {
    lines.push('', 'By reason:')
    for (const s of report.byReason) {
      lines.push(
        `  ${s.key.padEnd(22)} ${s.winPct === null ? '-' : `${s.winPct}%`}  (${s.runs})${thin(s.runs)}`,
      )
    }
  }

  lines.push(
    '',
    `Avg messages to success: ${report.avgMessagesToWin ?? '-'}`,
    `Negative reaction rate:  ${report.negativeReactionPct === null ? '-' : `${report.negativeReactionPct}%`}`,
  )
  return lines.join('\n')
}
