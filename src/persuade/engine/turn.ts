import { generateObject } from 'ai';
import { z } from 'zod';
import { model } from '../lib/model';
import { historyForModel, persuaderSystemPrompt, type Recipient } from './prompts';
import { checkTurn, DEFAULT_RULES, detectOutcome, fatigueScore, nextRung, shouldStop, type RuleConfig } from './rules';
import type { ConversationState, PersuasionPlan, RuleViolation, Rung, Turn } from './types';

const BLOCKER_IDS = [
  'no_why', 'no_price', 'overloaded', 'dont_know_how', 'thinks_already_doing',
  'vague_definition', 'disagrees', 'afraid', 'low_confidence', 'low_energy',
  'overwhelmed', 'agrees_no_action', 'repeated_no_action', 'refuses_role',
  'unclear_request', 'wants_autonomy', 'skeptical', 'wants_to_quit', 'none',
] as const;

const turnSchema = z.object({
  blocker: z.enum(BLOCKER_IDS).describe('מה עוצר אותו עכשיו, לפי מה שהוא כתב'),
  evidence: z.string().describe('הציטוט או הסימן שממנו הסקת את זה'),
  tools: z.array(z.string()).min(1).max(2).describe('הכלים שבחרת להשתמש בהם עכשיו'),
  message: z.string().describe('ההודעה עצמה. עברית פשוטה. משפטים עד 15 מילים.'),
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
});

export interface TurnResult {
  turn: Turn;
  state: ConversationState;
  stopped: { stop: boolean; reason: string | null };
}

/** One persuader move: diagnose, choose a tool, speak, then get graded by the rule engine. */
export async function persuaderTurn(
  plan: PersuasionPlan,
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
  recipient: Recipient | null = null,
): Promise<TurnResult> {
  const targetTurns = turns.filter((t) => t.role === 'target');
  const workingState: ConversationState = {
    ...state,
    fatigue: fatigueScore(targetTurns),
    rung: turns.length === 0 ? 1 : nextRung(state, rules),
  };

  const { object } = await generateObject({
    model: model('persuader'),
    schema: turnSchema,
    system: persuaderSystemPrompt(plan, workingState, turns.some((t) => t.role === 'persuader'), rules, recipient),
    messages:
      turns.length === 0
        ? [{ role: 'user' as const, content: 'התחל את השיחה.' }]
        : historyForModel(turns),
  });

  const isGreetingTurn = !turns.some((t) => t.role === 'persuader');
  const violations: RuleViolation[] = checkTurn(object.message, {
    plan,
    state: workingState,
    rules,
    isGreetingTurn,
    statesAsk: object.statesAsk,
    argumentsUsed: object.argumentsUsed,
    askedForDecision: object.asksForDecision,
  });

  // The opener buys goodwill, it does not spend one of the four attempts.
  const isPersuasionAttempt = workingState.askStated || object.statesAsk;
  const interaction = isPersuasionAttempt ? workingState.interaction + 1 : workingState.interaction;

  const turn: Turn = {
    role: 'persuader',
    text: object.message,
    interaction,
    rung: workingState.rung as Rung,
    blocker: object.blocker,
    tools: object.tools,
    violations,
  };

  // Keyword matching catches the obvious "סגור". The model catches "אם אתה בודק, אז
  // בסדר" -- a yes wearing the clothes of a fatigue marker. Neither may fire before
  // the ask exists, and a counter-offer is not an agreement to the ask.
  const hasCounterpartReplied = turns.some((t) => t.role === 'target');
  const canReadOutcome = workingState.askStated && hasCounterpartReplied;
  const readOutcome: ConversationState['outcome'] = !canReadOutcome
    ? workingState.outcome
    : object.counterpartCommitted
      ? 'agreed'
      : object.counterpartRefused
        ? 'refused'
        : workingState.outcome;

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
  };

  return { turn, state: newState, stopped: shouldStop(newState, rules) };
}

/** Fold a counterpart reply into the state: outcome, fatigue, interaction bookkeeping. */
export function applyTargetReply(
  text: string,
  turns: Turn[],
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
): { turn: Turn; state: ConversationState; stopped: { stop: boolean; reason: string | null } } {
  const turn: Turn = { role: 'target', text, interaction: state.interaction };
  const allTargetTurns = [...turns.filter((t) => t.role === 'target'), turn];
  const outcome = detectOutcome(text);
  const newState: ConversationState = {
    ...state,
    fatigue: fatigueScore(allTargetTurns),
    outcome: outcome === 'open' ? state.outcome : outcome,
  };
  return { turn, state: newState, stopped: shouldStop(newState, rules) };
}
