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
  return { attempted: [...offered], won }
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

/**
 * Whether every run behind this report came from the same models.
 *
 * The same check `readiness()` runs for an experiment's arms, needed here too:
 * `buildEffectiveness` pools every run it is given into one win rate per
 * technique, and a `PERSUADER_MODEL` swap in the middle of that pool would
 * still render as a clean, confident number -- it would just be measuring the
 * swap. `worker.ts` stores `models` on every run precisely so this is
 * checkable; this report never checked it.
 */
export function modelWarning(inputs: readonly EffectivenessInput[]): string | null {
  const fingerprints = new Set(inputs.map((i) => JSON.stringify(i.run.models ?? null)))
  if (fingerprints.size > 1) {
    return 'הריצות שנספרו כאן רצו על יותר מצירוף מודלים אחד — שיעורי ההצלחה עלולים לשקף החלפת מודל ולא את הטכניקה'
  }
  return null
}

export function buildEffectiveness(inputs: readonly EffectivenessInput[]): TechniqueReport[] {
  const byCategory = new Map<
    ArgumentCategory,
    {
      runs: number
      wins: number
      messages: number[]
      negative: number
      reasons: { key: Reason | null; won: boolean }[]
      personas: { key: string | null; won: boolean }[]
    }
  >()

  for (const { run, offered } of inputs) {
    const { attempted, won } = categoriesInPlay(run, offered)

    for (const category of new Set(attempted)) {
      const at = byCategory.get(category) ?? {
        runs: 0,
        wins: 0,
        messages: [],
        negative: 0,
        reasons: [],
        personas: [],
      }
      const isWin = won === category
      at.runs += 1
      if (isWin) {
        at.wins += 1
        at.messages.push(run.turns.filter((t) => t.role === 'persuader').length)
      }
      // Worn down rather than persuaded. Counted per technique that was on the
      // table, because a technique cannot be credited for a win and excused
      // from the exhaustion in the same conversation.
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
      if (run.outcome === 'stopped_fatigue' || run.fatigue >= 0.7) at.negative += 1
      at.reasons.push({ key: run.world?.reason ?? null, won: isWin })
      at.personas.push({ key: run.personaId, won: isWin })
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
      negativeReactionPct: pct(v.negative, v.runs),
      byReason: sliceBy(v.reasons),
      byPersona: sliceBy(v.personas),
    }))
    .sort((a, b) => (b.winPct ?? -1) - (a.winPct ?? -1))
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

  if (report.byPersona.length > 0) {
    lines.push('', 'By persona:')
    for (const s of report.byPersona) {
      lines.push(`  ${s.key.padEnd(22)} ${s.winPct === null ? '-' : `${s.winPct}%`}  (${s.runs})`)
    }
  }

  if (report.byReason.length > 0) {
    lines.push('', 'By reason:')
    for (const s of report.byReason) {
      lines.push(`  ${s.key.padEnd(22)} ${s.winPct === null ? '-' : `${s.winPct}%`}  (${s.runs})`)
    }
  }

  lines.push(
    '',
    `Avg messages to success: ${report.avgMessagesToWin ?? '-'}`,
    `Negative reaction rate:  ${report.negativeReactionPct === null ? '-' : `${report.negativeReactionPct}%`}`,
  )
  return lines.join('\n')
}
