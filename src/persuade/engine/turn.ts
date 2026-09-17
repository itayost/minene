import { generateObject, streamObject } from 'ai'
import { z } from 'zod'
import { callOptions, model } from '../lib/model'
import { historyForModel, persuaderSystemPrompt, type Recipient } from './prompts'
import {
  checkTurn,
  DEFAULT_RULES,
  detectOutcome,
  fatigueScore,
  nextRung,
  type RuleConfig,
  shouldStop,
} from './rules'
import type { ConversationState, PersuasionPlan, RuleViolation, Rung, Turn } from './types'
import { recordUsage } from './usage'

const BLOCKER_IDS = [
  'no_why',
  'no_price',
  'overloaded',
  'dont_know_how',
  'thinks_already_doing',
  'vague_definition',
  'disagrees',
  'afraid',
  'low_confidence',
  'low_energy',
  'overwhelmed',
  'agrees_no_action',
  'repeated_no_action',
  'refuses_role',
  'unclear_request',
  'wants_autonomy',
  'skeptical',
  'wants_to_quit',
  'none',
] as const

const turnSchema = z.object({
  blocker: z.enum(BLOCKER_IDS).describe('מה עוצר אותו עכשיו, לפי מה שהוא כתב'),
  evidence: z.string().describe('הציטוט או הסימן שממנו הסקת את זה'),
  tools: z.array(z.string()).min(1).max(2).describe('הכלים שבחרת להשתמש בהם עכשיו'),
  // No number here. The limits are `rules.maxWordsPerSentence` and
  // `maxWordsPerMessage`, they are configurable from the rules page, they are
  // stated in the system prompt and they are enforced in checkTurn -- so a
  // second copy hardcoded in a schema description is one that goes stale the
  // first time somebody changes them, telling the model 15 while the engine
  // grades it against 12.
  message: z.string().describe('ההודעה עצמה. עברית פשוטה. משפטים קצרים כמו בוואטסאפ.'),
  asksForDecision: z.boolean().describe('האם ההודעה מבקשת ממנו כן או לא'),
  counterpartCommitted: z
    .boolean()
    .describe(
      'האם הוא התחייב לבצע את הבקשה כפי שנוסחה. הצעה נגדית, ביצוע חלקי, ' +
        '"נראה", "אולי" או הסכמה לגרסה מוקטנת אינם הסכמה. בספק - false.',
    ),
  counterpartRefused: z
    .boolean()
    .describe('האם הוא סירב במפורש לבצע. הצעה נגדית אינה סירוב. בספק - false.'),
  setsStartTime: z.boolean().describe('האם ההודעה קובעת מתי מתחילים, ביום או בתאריך'),
  announcesFollowUp: z.boolean().describe('האם ההודעה אומרת שנבדוק אם זה קרה'),
  statesAsk: z.boolean().describe('האם ההודעה מכילה את הבקשה המדויקת'),
  statesIdentity: z.boolean().describe('האם ההודעה מציגה בשם מי אתה פונה'),
  argumentsUsed: z.number().min(0).max(5).describe('כמה טיעונים שונים הכנסת להודעה'),
  signals: z.object({
    motivatedBy: z.array(z.string()).describe('מה נראה שמניע אותו, לפי מה שאמר'),
    energy: z.enum(['low', 'medium', 'high', 'unknown']),
    autonomyNeed: z.enum(['low', 'medium', 'high', 'unknown']),
    respondsToNumbers: z.boolean().nullable(),
  }),
})

export interface TurnResult {
  turn: Turn
  state: ConversationState
  stopped: { stop: boolean; reason: string | null }
}

type TurnObject = z.infer<typeof turnSchema>

/** Everything the two entry points below share: the state the move is made from, and the call. */
function turnRequest(
  plan: PersuasionPlan,
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig,
  recipient: Recipient | null,
) {
  const targetTurns = turns.filter((t) => t.role === 'target')
  const workingState: ConversationState = {
    ...state,
    fatigue: fatigueScore(targetTurns),
    rung: turns.length === 0 ? 1 : nextRung(state, rules),
  }

  return {
    workingState,
    call: {
      model: model('persuader'),
      schema: turnSchema,
      system: persuaderSystemPrompt(
        plan,
        workingState,
        turns.some((t) => t.role === 'persuader'),
        rules,
        recipient,
      ),
      messages:
        turns.length === 0
          ? [{ role: 'user' as const, content: 'התחל את השיחה.' }]
          : historyForModel(turns),
      ...callOptions('persuader'),
    },
  }
}

/** One persuader move: diagnose, choose a tool, speak, then get graded by the rule engine. */
export async function persuaderTurn(
  plan: PersuasionPlan,
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
  recipient: Recipient | null = null,
): Promise<TurnResult> {
  const { workingState, call } = turnRequest(plan, turns, state, rules, recipient)
  const { object, usage } = await generateObject(call)
  recordUsage('persuader', usage)
  return gradeTurn(object, plan, turns, workingState, rules)
}

export type TurnEvent = { type: 'delta'; text: string } | { type: 'done'; result: TurnResult }

/**
 * The same move, emitted as it is written.
 *
 * The grading is unchanged and still happens on the complete object: a rule
 * check run against half a sentence would report a message that is under the
 * word limit because it has not finished being written. What streams is the
 * text; what is judged is the message.
 *
 * The schema's field order is load-bearing here. `blocker`, `evidence` and
 * `tools` come before `message` because the engine's standing instruction is
 * "קודם אבחן... ורק אז כתוב", and that ordering is the thing making the model
 * diagnose before it speaks. They are three short fields, so the text still
 * starts arriving in about a second -- the diagnosis is not what the wait was.
 */
export async function* streamPersuaderTurn(
  plan: PersuasionPlan,
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
  recipient: Recipient | null = null,
): AsyncGenerator<TurnEvent> {
  const { workingState, call } = turnRequest(plan, turns, state, rules, recipient)
  const { partialObjectStream, object } = streamObject(call)

  let sent = 0
  for await (const partial of partialObjectStream) {
    const message = partial.message
    if (typeof message !== 'string' || message.length <= sent) continue
    yield { type: 'delta', text: message.slice(sent) }
    sent = message.length
  }

  // Awaited after the stream is drained, never instead of it: this promise is
  // what validates the object against the schema, and skipping it would let a
  // reply through that streamed beautifully and carried no blocker, no ask flag
  // and no commitment reading -- the fields every downstream decision is made
  // from.
  yield { type: 'done', result: gradeTurn(await object, plan, turns, workingState, rules) }
}

/** The deterministic half: rule check, interaction accounting, outcome reading. */
function gradeTurn(
  object: TurnObject,
  plan: PersuasionPlan,
  turns: Turn[],
  workingState: ConversationState,
  rules: RuleConfig,
): TurnResult {
  const isGreetingTurn = !turns.some((t) => t.role === 'persuader')
  const violations: RuleViolation[] = checkTurn(object.message, {
    plan,
    state: workingState,
    rules,
    isGreetingTurn,
    statesAsk: object.statesAsk,
    argumentsUsed: object.argumentsUsed,
    askedForDecision: object.asksForDecision,
  })

  // The opener buys goodwill, it does not spend one of the four attempts.
  const isPersuasionAttempt = workingState.askStated || object.statesAsk
  const interaction = isPersuasionAttempt ? workingState.interaction + 1 : workingState.interaction

  const turn: Turn = {
    role: 'persuader',
    text: object.message,
    interaction,
    rung: workingState.rung as Rung,
    blocker: object.blocker,
    tools: object.tools,
    violations,
    // Kept whole so a run can become a training example of the turn the engine
    // actually asks for, rather than of its message alone.
    output: object as unknown as Record<string, unknown>,
  }

  // Keyword matching catches the obvious "סגור". The model catches "אם אתה בודק, אז
  // בסדר" -- a yes wearing the clothes of a fatigue marker. Neither may fire before
  // the ask exists, and a counter-offer is not an agreement to the ask.
  const hasCounterpartReplied = turns.some((t) => t.role === 'target')
  const canReadOutcome = workingState.askStated && hasCounterpartReplied
  const readOutcome: ConversationState['outcome'] = !canReadOutcome
    ? workingState.outcome
    : object.counterpartCommitted
      ? 'agreed'
      : object.counterpartRefused
        ? 'refused'
        : workingState.outcome

  const newState: ConversationState = {
    ...workingState,
    outcome: workingState.outcome === 'open' ? readOutcome : workingState.outcome,
    interaction,
    blockers:
      object.blocker !== 'none' && !workingState.blockers.includes(object.blocker)
        ? [...workingState.blockers, object.blocker]
        : workingState.blockers,
    signals: object.signals,
    askStated: workingState.askStated || object.statesAsk,
    identityStated: workingState.identityStated || object.statesIdentity,
    startTimeSet: workingState.startTimeSet || object.setsStartTime,
    followUpAnnounced: workingState.followUpAnnounced || object.announcesFollowUp,
  }

  return { turn, state: newState, stopped: shouldStop(newState, rules) }
}

/** Fold a counterpart reply into the state: outcome, fatigue, interaction bookkeeping. */
export function applyTargetReply(
  text: string,
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
): { turn: Turn; state: ConversationState; stopped: { stop: boolean; reason: string | null } } {
  const turn: Turn = { role: 'target', text, interaction: state.interaction }
  const allTargetTurns = [...turns.filter((t) => t.role === 'target'), turn]
  const outcome = detectOutcome(text)
  const newState: ConversationState = {
    ...state,
    fatigue: fatigueScore(allTargetTurns),
    outcome: outcome === 'open' ? state.outcome : outcome,
  }
  return { turn, state: newState, stopped: shouldStop(newState, rules) }
}
