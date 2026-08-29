/**
 * Core types for the Persuader Engine.
 * Vocabulary follows Eran's persuasion model: prepare -> ask -> diagnose -> persuade -> decide -> measure.
 */

export type ArgumentCategory =
  | 'personal_benefit'
  | 'emotional_benefit'
  | 'career_money'
  | 'less_work_later'
  | 'org_benefit'
  | 'values_culture'
  | 'role_standard'
  | 'cost_of_inaction'
  | 'numbers'
  | 'social_proof'
  | 'authority'

export type BlockerId =
  | 'no_why'
  | 'no_price'
  | 'overloaded'
  | 'dont_know_how'
  | 'thinks_already_doing'
  | 'vague_definition'
  | 'disagrees'
  | 'afraid'
  | 'low_confidence'
  | 'low_energy'
  | 'overwhelmed'
  | 'agrees_no_action'
  | 'repeated_no_action'
  | 'refuses_role'
  | 'unclear_request'
  | 'wants_autonomy'
  | 'skeptical'
  | 'wants_to_quit'
  | 'none'

/** Escalation rungs. Always start at 1. Climb one rung at a time, never jump. */
export type Rung = 1 | 2 | 3 | 4 | 5

export type Outcome =
  | 'open'
  | 'agreed'
  | 'refused'
  | 'escalate_to_manager'
  | 'stopped_fatigue'
  | 'deferred'

/** The ask must be "photographable": you could film whether it happened. */
export interface Ask {
  what: string
  withWhom: string
  durationMinutes: number
  frequency: string
  when: string
  script: string[]
  trialPeriod: string
  oneLiner: string
}

export interface Argument {
  id: string
  category: ArgumentCategory
  text: string
  /**
   * 1-10. Measured rather than estimated whenever the argument came from a rule
   * the floor has rated -- see applyMeasuredStrength in prepare.ts. Only an
   * argument the model wrote itself, or one drawn from an unrated rule, still
   * carries a guess.
   */
  strength: number
  why: string
  /**
   * The rule this argument was taken from, when the plan was assembled from the
   * organization's knowledge base rather than invented. Null for an argument the
   * model phrased itself, and absent entirely on a plan prepared without a
   * knowledge base behind it.
   */
  sourceRuleNumber?: number | null
}

export interface ObjectionHandler {
  objection: string
  response: string
}

export interface EscalationStep {
  rung: Rung
  message: string
}

export interface OnBehalfOf {
  name: string
  title: string
  mandate: string
}

/** Stage 0 output. Nothing is said to the user before this exists. */
export interface PersuasionPlan {
  id: string
  topic: string
  ask: Ask
  onBehalfOf: OnBehalfOf | null
  currentStateQuestions: string[]
  arguments: Argument[]
  objections: ObjectionHandler[]
  escalation: EscalationStep[]
  stopPoint: string
  successCriteria: string
}

export interface Signals {
  motivatedBy: string[]
  energy: 'low' | 'medium' | 'high' | 'unknown'
  autonomyNeed: 'low' | 'medium' | 'high' | 'unknown'
  respondsToNumbers: boolean | null
}

export interface ConversationState {
  interaction: number
  rung: Rung
  blockers: BlockerId[]
  signals: Signals
  fatigue: number
  outcome: Outcome
  askStated: boolean
  identityStated: boolean
  /** The persuader named a day or time to start. Read by the follow-up phase. */
  startTimeSet: boolean
  /** The persuader said the result would be checked. */
  followUpAnnounced: boolean
}

export interface Turn {
  role: 'persuader' | 'target'
  text: string
  interaction: number
  rung?: Rung
  blocker?: BlockerId
  tools?: string[]
  violations?: RuleViolation[]
}

export interface RuleViolation {
  rule: string
  detail: string
  severity: 'critical' | 'high' | 'medium'
}

export interface Run {
  /** Set by a separate scoring pass, so absent on a run nobody has judged. */
  score?: RunScore
  /** Set when somebody reported what actually happened. */
  followUp?: FollowUp
  id: string
  createdAt: string
  planId: string
  /** null when a person sat in the counterpart's seat. */
  personaId: string | null
  plan: PersuasionPlan
  persona: TargetPersona | null
  turns: Turn[]
  state: ConversationState
  violations: RuleViolation[]
}

export interface TargetPersona {
  id: string
  name: string
  role: string
  resistance: 1 | 2 | 3 | 4 | 5
  /** How reliably this person converts a yes into a done. Drives the follow-up phase. */
  reliability: 1 | 2 | 3 | 4 | 5
  situation: string
  hiddenTruth: string
  motivatedBy: string[]
  style: string
  agreesWhen: string
}

/**
 * What a scored run knows about itself. Optional on Run because scoring is a
 * separate pass: a conversation is complete before anyone has judged it.
 */
export interface RunScore {
  persuaded: 'yes' | 'no' | 'partial'
  winningArgument: string | null
  winningCategory: ArgumentCategory | null
  mainObjection: string | null
  whatBrokeIt: string | null
  whatFailed: string | null
  grade: number
  notes: string
  /** How many interactions it took. Cheap to record, and the rates use it. */
  interactionsUsed: number
}

/** What actually happened afterwards. A partial is recorded, never rounded up. */
export interface FollowUpReport {
  executed: 'yes' | 'no' | 'partial'
  timesDone: number
  whatHappened: string
}

export interface FollowUp {
  report: FollowUpReport
}

/**
 * A rate is null when its denominator is zero, never 0.
 *
 * "Nobody has agreed yet" and "everybody who agreed failed to do it" are
 * opposite facts, and reporting the first as 0% claims total failure where
 * there is nothing to report. The same null-is-not-zero rule the knowledge
 * base's like_pct already follows.
 */
export interface Rates {
  runs: number
  agreed: number
  executed: number

  persuasionRate: number | null
  executionRate: number | null
  deliveryRate: number | null

  avgInteractionsToYes: number | null
  violationsPerRun: number | null
  criticalViolationsPerRun: number | null

  byArgumentCategory: { category: ArgumentCategory; closes: number }[]
  byPersona: {
    personaId: string
    runs: number
    persuasionRate: number | null
    executionRate: number | null
  }[]
  byBlocker: { blocker: BlockerId; encountered: number; overcome: number }[]
  topViolations: { rule: string; count: number }[]
}
