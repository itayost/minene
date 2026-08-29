import { randomUUID } from 'node:crypto'
import { DEFAULT_RULES, initialState, type RuleConfig } from './rules'
import { targetReply } from './target'
import { applyTargetReply, persuaderTurn } from './turn'
import type {
  ConversationState,
  PersuasionPlan,
  RuleViolation,
  Run,
  TargetPersona,
  Turn,
} from './types'
import type { WorldState } from './world'

/**
 * A conversation between two parties: the persuader, which works by the rules, and
 * the counterpart. Here the counterpart is a simulated persona; when a person takes
 * that seat the same turn functions are driven from the chat route instead.
 */

export interface SimulationInput {
  plan: PersuasionPlan
  persona: TargetPersona
  rules?: RuleConfig
  /**
   * The closed world this run happens inside.
   *
   * Passed to targetReply and to nothing else. persuaderTurn below takes the
   * plan, the turns, the state and the rules -- it has no parameter this could
   * be handed to, which is the isolation being structural rather than a
   * convention somebody remembers.
   */
  world?: WorldState | null
}

export type SimulationEvent =
  | { type: 'turn'; turn: Turn; state: ConversationState }
  | { type: 'stopped'; reason: string }
  | { type: 'done'; run: Run }

export async function* runSimulation(input: SimulationInput): AsyncGenerator<SimulationEvent> {
  const { plan, persona, rules = DEFAULT_RULES, world = null } = input
  const turns: Turn[] = []
  let state = initialState()
  let stopReason: string | null = null

  // The greeting is a turn but not a persuasion attempt, so allow one extra round.
  for (let i = 0; i < rules.maxInteractions + 1; i += 1) {
    const p = await persuaderTurn(plan, turns, state, rules, {
      name: persona.name,
      role: persona.role,
    })
    turns.push(p.turn)
    state = p.state
    yield { type: 'turn', turn: p.turn, state }

    if (p.stopped.stop) {
      stopReason = p.stopped.reason
      break
    }

    const reply = await targetReply(persona, plan, turns, world)
    const t = applyTargetReply(reply, turns, state, rules)
    turns.push(t.turn)
    state = t.state
    yield { type: 'turn', turn: t.turn, state }

    if (t.stopped.stop) {
      stopReason = t.stopped.reason
      break
    }
  }

  if (stopReason) yield { type: 'stopped', reason: stopReason }

  const violations: RuleViolation[] = turns.flatMap((t) => t.violations ?? [])
  const finalState: ConversationState = {
    ...state,
    outcome:
      state.outcome !== 'open'
        ? state.outcome
        : state.fatigue >= rules.fatigueThreshold
          ? 'stopped_fatigue'
          : 'deferred',
  }

  yield {
    type: 'done',
    run: {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      planId: plan.id,
      personaId: persona.id,
      plan,
      persona,
      turns,
      state: finalState,
      violations,
    },
  }
}
