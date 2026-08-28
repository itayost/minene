import { generateText } from 'ai';
import { callOptions, model } from '../lib/model';
import { historyForTarget, targetSystemPrompt } from './prompts';
import type { PersuasionPlan, TargetPersona, Turn } from './types';

/**
 * The simulated counterpart. Personas live in content/personas and are drawn from the
 * simulations in the source conversation, so runs replay failure modes found by hand.
 */

export async function targetReply(
  persona: TargetPersona,
  plan: PersuasionPlan,
  turns: Turn[],
): Promise<string> {
  const { text } = await generateText({
    model: model('target'),
    system: targetSystemPrompt(persona, plan),
    messages: historyForTarget(turns),
    ...callOptions('target'),
  });
  return text.trim();
}
