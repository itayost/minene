import { DEFAULT_RULES, isAskPhotographable, type RuleConfig } from './rules';
import type { PersuasionPlan } from './types';

/**
 * Everything that governs the persuader, in one object: how it is allowed to behave,
 * and what it is trying to get done. This is what the rules page edits and what every
 * conversation request carries, so no two runs disagree about the rules in force.
 */
export interface BotConfig {
  rules: RuleConfig;
  plan: PersuasionPlan;
}

/**
 * Bump whenever the shape changes. A config written by an older build is discarded
 * rather than half-read: a plan missing its mandate produces a bot that says it is
 * calling on its own behalf, and nothing in the UI would tell you why.
 */
export const CONFIG_VERSION = 2;

export interface StoredConfig {
  version: number;
  config: BotConfig;
}

/** Returns null when the stored value is absent, corrupt, or from an older shape. */
export function readStoredConfig(raw: string | null): BotConfig | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    if (parsed.version !== CONFIG_VERSION || !parsed.config) return null;
    const { rules, plan } = parsed.config;
    if (!rules || !plan || !plan.ask || !Array.isArray(plan.arguments)) return null;
    return parsed.config;
  } catch {
    return null;
  }
}

export interface ConfigProblem {
  field: string;
  message: string;
}

/** Reject a config that would produce a conversation nobody could act on. */
export function validateConfig(config: BotConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const { rules, plan } = config;

  const gate = isAskPhotographable(plan);
  if (!gate.ok) {
    problems.push({
      field: 'ask',
      message: `הבקשה לא מספיק מדויקת. חסר: ${gate.missing.join(', ')}`,
    });
  }

  if (!plan.topic.trim()) problems.push({ field: 'topic', message: 'צריך נושא' });
  if (plan.arguments.length === 0) {
    problems.push({ field: 'arguments', message: 'צריך לפחות טיעון אחד' });
  }
  if (plan.escalation.length === 0) {
    problems.push({ field: 'escalation', message: 'צריך לפחות מדרגת הסלמה אחת' });
  }
  if (rules.maxInteractions < 1) {
    problems.push({ field: 'maxInteractions', message: 'צריך לפחות אינטראקציה אחת' });
  }
  if (rules.maxWordsPerSentence < 3) {
    problems.push({ field: 'maxWordsPerSentence', message: 'מעט מדי מילים למשפט' });
  }
  if (rules.maxWordsPerMessage < rules.maxWordsPerSentence) {
    problems.push({
      field: 'maxWordsPerMessage',
      message: 'הודעה לא יכולה להיות קצרה ממשפט אחד',
    });
  }

  if (plan.onBehalfOf && !plan.onBehalfOf.name.trim()) {
    problems.push({ field: 'onBehalfOf', message: 'אם פונים בשם מישהו, צריך שם' });
  }

  return problems;
}

export function emptyPlan(): PersuasionPlan {
  return {
    id: 'custom',
    topic: '',
    ask: {
      what: '',
      withWhom: '',
      durationMinutes: 5,
      frequency: '',
      when: '',
      script: [],
      trialPeriod: '',
      oneLiner: '',
    },
    onBehalfOf: null,
    currentStateQuestions: [],
    arguments: [],
    objections: [],
    escalation: [],
    stopPoint: '',
    successCriteria: '',
  };
}

export function defaultConfig(plan: PersuasionPlan): BotConfig {
  return { rules: { ...DEFAULT_RULES }, plan };
}

export function toStored(config: BotConfig): string {
  return JSON.stringify({ version: CONFIG_VERSION, config } satisfies StoredConfig);
}
