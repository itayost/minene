import { historyForModel, persuaderSystemPrompt, type Recipient } from '../engine/prompts'
import { DEFAULT_RULES, type RuleConfig } from '../engine/rules'
import type { PersuasionPlan, Run, RunScore, Turn } from '../engine/types'

/**
 * Turning stored simulations into a fine-tuning set.
 *
 * The honest claim for this: it is a latency and cost play, not an intelligence
 * one. The persuader currently carries about 2,500 tokens of system prompt on
 * every turn -- the blocker table, the plan, the state, the language laws -- and
 * a model trained on enough good turns internalises most of that. Training on
 * your own outputs, judged by a model of the same family, concentrates the
 * teacher's best behaviour; it does not exceed it.
 *
 * Which makes selection the whole game, and this is where this engine has an
 * advantage most self-distillation setups do not: `checkTurn` is a deterministic
 * rule engine. Word limits, arguments per turn, identity stated, questions
 * before the ask -- all decided in code. So two thirds of the filter below is
 * model-independent, and only the grade comes from a judge.
 *
 * Reads simulations and never conversations. A simulation is invented and holds
 * nobody's private knowledge; a conversation is a real exchange with a named
 * employee about their own performance, and it does not belong in a training
 * file however good it was.
 */

export interface DatasetFilter {
  /** Only runs that ended in an explicit yes. */
  requireAgreed?: boolean
  /** Only turns the rule engine passed clean. Deterministic, not a model's opinion. */
  requireCleanTurns?: boolean
  minGrade?: number
}

export const DEFAULT_FILTER: Required<DatasetFilter> = {
  requireAgreed: true,
  requireCleanTurns: true,
  minGrade: 70,
}

/** One row of the JSONL: the turn as the model is asked for it in production. */
export interface TrainingExample {
  messages: (
    | { role: 'system'; content: string }
    | { role: 'user'; content: string }
    | { role: 'assistant'; content: string }
  )[]
}

export interface SourceRun {
  run: Run
  score: RunScore | null
  rules: RuleConfig | null
  persona: Recipient | null
}

export interface ExportReport {
  examples: TrainingExample[]
  /** Every reason a turn was dropped, counted. A silent filter is unreadable. */
  rejected: Record<string, number>
}

const reject = (report: Record<string, number>, reason: string) => {
  report[reason] = (report[reason] ?? 0) + 1
}

/**
 * Rebuilds the exact prompt the model saw, turn by turn.
 *
 * Replayed rather than stored, because the prompt is a pure function of the
 * plan, the state at that moment and the rules -- and storing 2,500 tokens per
 * turn to avoid recomputing them would be the larger mistake. The cost is that
 * the replay has to walk the conversation forward in the same order the engine
 * did; getting that wrong produces examples that look right and teach the model
 * to answer a question it was never asked.
 */
export function examplesFromRun(
  source: SourceRun,
  filter: Required<DatasetFilter>,
  report: Record<string, number>,
): TrainingExample[] {
  const { run, score, rules, persona } = source
  const examples: TrainingExample[] = []

  if (filter.requireAgreed && run.state.outcome !== 'agreed') {
    reject(report, 'run-not-agreed')
    return examples
  }
  if (filter.minGrade > 0) {
    if (!score) {
      reject(report, 'run-unscored')
      return examples
    }
    if (score.grade < filter.minGrade) {
      reject(report, 'run-below-grade')
      return examples
    }
  }

  const config = rules ?? DEFAULT_RULES
  const before: Turn[] = []

  for (const turn of run.turns) {
    if (turn.role !== 'persuader') {
      before.push(turn)
      continue
    }

    const answer = turn.output
    // A turn stored before `output` existed carries its text and nothing else.
    // Training a structured task on a text-only example teaches the model to
    // answer with a string where production expects fourteen fields.
    if (!answer) {
      reject(report, 'turn-missing-structured-output')
      before.push(turn)
      continue
    }
    if (filter.requireCleanTurns && (turn.violations?.length ?? 0) > 0) {
      reject(report, 'turn-broke-a-rule')
      before.push(turn)
      continue
    }

    examples.push({
      messages: [
        {
          role: 'system',
          content: persuaderSystemPrompt(
            run.plan as PersuasionPlan,
            // The state the engine held when it asked, not the final state.
            stateBefore(run, before),
            before.some((t) => t.role === 'persuader'),
            config,
            persona,
          ),
        },
        ...(before.length === 0
          ? [{ role: 'user' as const, content: 'התחל את השיחה.' }]
          : historyForModel(before)),
        { role: 'assistant', content: JSON.stringify(answer) },
      ],
    })
    before.push(turn)
  }

  return examples
}

/**
 * The conversation state as it stood before a given turn.
 *
 * Reconstructed from the turns rather than stored per turn. Only the fields the
 * system prompt actually reads are rebuilt -- interaction, rung, blockers,
 * askStated, identityStated -- because those are what shape the text, and
 * inventing the rest would put fabricated numbers into a training prompt.
 */
function stateBefore(run: Run, before: Turn[]): Run['state'] {
  const persuaderTurns = before.filter((t) => t.role === 'persuader')
  const last = persuaderTurns.at(-1)
  const blockers = [
    ...new Set(
      persuaderTurns
        .map((t) => t.blocker)
        .filter((b): b is NonNullable<typeof b> => !!b && b !== 'none'),
    ),
  ]

  return {
    ...run.state,
    interaction: last?.interaction ?? 0,
    rung: last?.rung ?? 1,
    blockers,
    // Whether the ask had been stated by this point, read from the flags the
    // turns kept rather than assumed from position in the conversation.
    askStated: persuaderTurns.some((t) => t.output?.statesAsk === true),
    identityStated: persuaderTurns.some((t) => t.output?.statesIdentity === true),
  }
}

export function buildDataset(
  sources: readonly SourceRun[],
  filter: DatasetFilter = {},
): ExportReport {
  const merged = { ...DEFAULT_FILTER, ...filter }
  const rejected: Record<string, number> = {}
  const examples: TrainingExample[] = []
  const seen = new Set<string>()

  for (const source of sources) {
    for (const example of examplesFromRun(source, merged, rejected)) {
      // The same (prompt, answer) twice teaches nothing the first one did not
      // and weights it double. Identical openers are the common case: every run
      // of one plan starts from the same state.
      const key = JSON.stringify(example.messages)
      if (seen.has(key)) {
        reject(rejected, 'duplicate')
        continue
      }
      seen.add(key)
      examples.push(example)
    }
  }

  return { examples, rejected }
}

export const toJsonl = (examples: readonly TrainingExample[]): string =>
  examples.map((e) => JSON.stringify(e)).join('\n')
