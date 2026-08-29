import {
  COMMITMENT_MARKERS,
  FATIGUE_MARKERS,
  MAX_ARGUMENTS_PER_TURN,
  MAX_INTERACTIONS,
  MAX_WORDS_PER_MESSAGE,
  MAX_WORDS_PER_SENTENCE,
  REFUSAL_MARKERS,
} from './knowledge'
import type { ConversationState, Outcome, PersuasionPlan, RuleViolation, Rung, Turn } from './types'

/**
 * Deterministic guards. The model writes the words; this file decides whether
 * the words broke a rule. Violations are surfaced, not silently patched --
 * the point of the arena is to see where the engine drifts.
 */

/** The persuader's operating limits, in one place so they are easy to argue with. */
export interface RuleConfig {
  maxInteractions: number
  maxWordsPerSentence: number
  /** A message of legal sentences can still be a speech. Cap the whole thing. */
  maxWordsPerMessage: number
  maxArgumentsPerTurn: number
  /** Fatigue at or above this closes the conversation. Above 1 disables the check. */
  fatigueThreshold: number
  /** Open by saying on whose authority you are calling. */
  enforceIdentity: boolean
  /** Never interrogate before the ask is on the table. */
  enforceAskBeforeQuestions: boolean
  /** Climb the ladder one rung at a time instead of jumping. */
  enforceOneRungAtATime: boolean
}

export const DEFAULT_RULES: RuleConfig = {
  maxInteractions: MAX_INTERACTIONS,
  maxWordsPerSentence: MAX_WORDS_PER_SENTENCE,
  maxWordsPerMessage: MAX_WORDS_PER_MESSAGE,
  maxArgumentsPerTurn: MAX_ARGUMENTS_PER_TURN,
  fatigueThreshold: 0.7,
  enforceIdentity: true,
  enforceAskBeforeQuestions: true,
  enforceOneRungAtATime: true,
}

const SENTENCE_SPLIT = /(?<=[.!?׃…]|\n)\s+/

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function longSentences(text: string, maxWords: number = MAX_WORDS_PER_SENTENCE): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && countWords(s) > maxWords)
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
}

function containsAny(text: string, markers: string[]): boolean {
  const t = normalize(text)
  return markers.some((m) => t.includes(normalize(m)))
}

/**
 * Fatigue score 0-1. Rises with non-committal markers and with replies that keep
 * getting shorter -- the pattern Eran described: 30 words, then 12, then "בסדר".
 *
 * Only replies given after the ask was stated count. A terse "בסדר. מה נסגר?" to a
 * greeting is someone busy, not someone worn down by being persuaded.
 */
export function fatigueScore(targetTurns: Turn[]): number {
  const underPersuasion = targetTurns.filter((t) => t.interaction >= 1)
  if (underPersuasion.length === 0) return 0
  const recent = underPersuasion.slice(-3)
  let score = 0

  // minene compiles with noUncheckedIndexedAccess, which eran-presueder did
  // not, so these reads are typed as possibly-undefined here. The early return
  // above proves recent is non-empty, but the compiler cannot see that through
  // slice -- and the honest fix is to handle the case rather than assert it
  // away, since the same code shapes a shrinking-reply check below where an
  // undefined length would silently compare as false.
  const last = recent.at(-1)
  if (!last) return 0

  if (containsAny(last.text, FATIGUE_MARKERS) && countWords(last.text) <= 6) score += 0.5
  if (countWords(last.text) <= 3) score += 0.2

  const [first, second, third] = recent.map((t) => countWords(t.text))
  if (first !== undefined && second !== undefined && third !== undefined) {
    const shrinking = first > second && second > third
    if (shrinking) score += 0.3
  }

  const nonCommittal = underPersuasion.filter(
    (t) => containsAny(t.text, FATIGUE_MARKERS) && !containsAny(t.text, COMMITMENT_MARKERS),
  ).length
  score += Math.min(nonCommittal * 0.1, 0.3)

  return Math.min(Number(score.toFixed(2)), 1)
}

/** Read the counterpart's reply for an explicit decision. Silence is not a yes. */
export function detectOutcome(targetText: string): Outcome {
  if (containsAny(targetText, REFUSAL_MARKERS)) return 'refused'
  if (containsAny(targetText, COMMITMENT_MARKERS)) return 'agreed'
  return 'open'
}

export function initialState(): ConversationState {
  return {
    interaction: 0,
    rung: 1,
    blockers: [],
    signals: {
      motivatedBy: [],
      energy: 'unknown',
      autonomyNeed: 'unknown',
      respondsToNumbers: null,
    },
    fatigue: 0,
    outcome: 'open',
    askStated: false,
    identityStated: false,
    startTimeSet: false,
    followUpAnnounced: false,
  }
}

/** Climb one rung at a time, never jump. Rung is capped by the interaction number. */
export function nextRung(state: ConversationState, rules: RuleConfig = DEFAULT_RULES): Rung {
  if (!rules.enforceOneRungAtATime) return Math.min(state.interaction + 1, 5) as Rung
  const target = Math.min(state.interaction + 1, 5)
  const allowed = Math.min(state.rung + 1, target, 5)
  return Math.max(1, allowed) as Rung
}

/** Should the persuader stop talking? */
export function shouldStop(
  state: ConversationState,
  rules: RuleConfig = DEFAULT_RULES,
): { stop: boolean; reason: string | null } {
  if (state.outcome === 'agreed') return { stop: true, reason: 'הושגה הסכמה מפורשת' }
  if (state.outcome === 'refused')
    return { stop: true, reason: 'סירוב מפורש. עוברים לחלופה או להעברה למנהל' }
  if (state.interaction >= rules.maxInteractions)
    return { stop: true, reason: `עברנו ${rules.maxInteractions} אינטראקציות בלי החלטה` }
  // Fatigue measures replies decaying under persuasion. Before the ask is on the
  // table a terse "בסדר" is just someone busy, not someone worn down.
  if (state.interaction >= 1 && state.fatigue >= rules.fatigueThreshold) {
    return { stop: true, reason: 'עייפות שכנוע גבוהה' }
  }
  return { stop: false, reason: null }
}

export interface CheckContext {
  plan: PersuasionPlan
  state: ConversationState
  rules?: RuleConfig
  /** The opener: greeting plus mandate. Not yet a persuasion attempt. */
  isGreetingTurn: boolean
  /** Whether this very message puts the concrete ask on the table. */
  statesAsk: boolean
  argumentsUsed: number
  askedForDecision: boolean
}

/** Rule check on a single persuader message. */
export function checkTurn(text: string, ctx: CheckContext): RuleViolation[] {
  const violations: RuleViolation[] = []
  const {
    plan,
    state,
    rules = DEFAULT_RULES,
    isGreetingTurn,
    statesAsk,
    argumentsUsed,
    askedForDecision,
  } = ctx

  const long = longSentences(text, rules.maxWordsPerSentence)
  if (long.length > 0) {
    violations.push({
      rule: `משפט ארוך מ-${rules.maxWordsPerSentence} מילים`,
      detail: long.map((s) => `"${s.slice(0, 60)}..." (${countWords(s)} מילים)`).join(' | '),
      severity: 'medium',
    })
  }

  const messageWords = countWords(text)
  if (messageWords > rules.maxWordsPerMessage) {
    violations.push({
      rule: `הודעה ארוכה מ-${rules.maxWordsPerMessage} מילים`,
      detail: `${messageWords} מילים. זו הרצאה, לא הודעה.`,
      severity: 'high',
    })
  }

  if (argumentsUsed > rules.maxArgumentsPerTurn) {
    violations.push({
      rule: 'יותר משני טיעונים בבת אחת',
      detail: `נעשה שימוש ב-${argumentsUsed} טיעונים. זו הרצאה, לא שיחה.`,
      severity: 'high',
    })
  }

  if (rules.enforceIdentity && isGreetingTurn && plan.onBehalfOf && !text.includes('בשם')) {
    violations.push({
      rule: 'לא הוצגה שליחות',
      detail: `צריך לפתוח ב"אני פונה אליך בשם ${plan.onBehalfOf.name}".`,
      severity: 'critical',
    })
  }

  // The greeting may ask "how are you". Anything after it may not interrogate
  // before the ask is on the table.
  const asksSomething = text.includes('?')
  const askOnTable = state.askStated || statesAsk || containsRequest(text, plan)
  if (rules.enforceAskBeforeQuestions && !isGreetingTurn && asksSomething && !askOnTable) {
    violations.push({
      rule: 'שאלות לפני בקשה',
      detail: 'אסור לחקור את המשתמש לפני שהוא יודע מה מבקשים ממנו ולמה כדאי לו.',
      severity: 'critical',
    })
  }

  if (state.interaction >= rules.maxInteractions && !askedForDecision) {
    violations.push({
      rule: 'אינטראקציה 4 בלי חתירה להחלטה',
      detail: 'בשלב הזה חייבים לבקש כן או לא, לא עוד טיעון.',
      severity: 'critical',
    })
  }

  if (state.interaction >= 1 && state.fatigue >= rules.fatigueThreshold && !askedForDecision) {
    violations.push({
      rule: 'התעלמות מעייפות שכנוע',
      detail: `מדד עייפות ${state.fatigue}. צריך לסגור, לא לנאום.`,
      severity: 'high',
    })
  }

  return violations
}

/** Loose check that the concrete ask actually appears in the message. */
export function containsRequest(text: string, plan: PersuasionPlan): boolean {
  const keywords = plan.ask.what
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 6)

  // No keywords means nothing to look for, and `0 >= Math.min(2, 0)` is true --
  // so this used to answer "yes, the ask is stated" for every message whenever
  // the ask had no word longer than three characters, silently disabling the
  // critical enforceAskBeforeQuestions check for exactly the vaguest asks.
  if (keywords.length === 0) return false

  const hits = keywords.filter((k) => text.includes(k)).length
  return hits >= Math.min(2, keywords.length)
}

/**
 * The gate from the model: if the counterpart could not repeat the ask in one
 * sentence, persuasion has not earned the right to start.
 */
export function isAskPhotographable(plan: PersuasionPlan): { ok: boolean; missing: string[] } {
  const missing: string[] = []
  const { ask } = plan
  if (!ask.what?.trim()) missing.push('מה בדיוק עושים')
  if (!ask.withWhom?.trim()) missing.push('עם מי')
  if (!ask.durationMinutes || ask.durationMinutes <= 0) missing.push('כמה זמן')
  if (!ask.frequency?.trim()) missing.push('באיזו תדירות')
  if (!ask.when?.trim()) missing.push('מתי')
  if (!ask.script?.length) missing.push('מה אומרים בפועל')
  if (!ask.trialPeriod?.trim()) missing.push('לכמה זמן מנסים')
  return { ok: missing.length === 0, missing }
}
