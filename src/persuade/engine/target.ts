import { generateText } from 'ai'
import { callOptions, model } from '../lib/model'
import { historyForTarget, targetSystemPrompt } from './prompts'
import type { PersuasionPlan, TargetPersona, Turn } from './types'
import { recordUsage } from './usage'
import type { WorldState } from './world'

/**
 * The simulated counterpart. Personas live in public.persuasion_personas, seeded
 * from the ones drawn out of the source conversation, so runs replay failure
 * modes that were found by hand.
 */

export async function targetReply(
  persona: TargetPersona,
  plan: PersuasionPlan,
  turns: Turn[],
  world: WorldState | null = null,
): Promise<string> {
  const { text, usage } = await generateText({
    model: model('target'),
    system: targetSystemPrompt(persona, plan, world),
    messages: historyForTarget(turns),
    ...callOptions('target'),
  })
  recordUsage('target', usage)
  return text.trim()
}
