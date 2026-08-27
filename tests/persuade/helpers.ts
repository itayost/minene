import { MockLanguageModelV3 } from 'ai/test';
import type { PersuasionPlan, Run, TargetPersona } from '../../src/persuade/engine/types';

/** Scripted language models, typed off the mock's own constructor so they stay in step with the SDK. */
type MockOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV3>[0]>;
type GenerateFn = Extract<NonNullable<MockOptions['doGenerate']>, (...args: never[]) => unknown>;
type GenerateResult = Awaited<ReturnType<GenerateFn>>;

function scripted(next: (index: number) => string): MockLanguageModelV3 {
  let i = 0;
  return new MockLanguageModelV3({
    doGenerate: async (): Promise<GenerateResult> => {
      const text = next(i);
      i += 1;
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
}

/** Replays JSON payloads for generateObject calls; the last one repeats. */
export function jsonModel(replies: unknown[]): MockLanguageModelV3 {
  return scripted((i) => JSON.stringify(replies[Math.min(i, replies.length - 1)]));
}

/**
 * A jsonModel that also keeps what it was asked. `MockLanguageModelV3`'s
 * doGenerate is a plain function rather than a spy, so a test that needs to
 * assert on the prompt has nowhere to read it from.
 */
export function recordingJsonModel(replies: unknown[]): {
  model: MockLanguageModelV3;
  prompts: () => string[];
} {
  const seen: string[] = [];
  let i = 0;
  const model = new MockLanguageModelV3({
    doGenerate: async (options): Promise<GenerateResult> => {
      seen.push(JSON.stringify(options.prompt));
      const text = JSON.stringify(replies[Math.min(i, replies.length - 1)]);
      i += 1;
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 10, text: 10, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, prompts: () => seen };
}

/** Replays plain text for generateText calls; the last one repeats. */
export function textModel(replies: string[]): MockLanguageModelV3 {
  // The clamp already keeps the index in range, but noUncheckedIndexedAccess
  // cannot see that. Falling back to '' rather than asserting: a scripted model
  // handed an empty list should reply with nothing, not crash the test that
  // forgot to script it.
  return scripted((i) => replies[Math.min(i, replies.length - 1)] ?? '');
}

/**
 * A model that answers plain text first and JSON afterwards. The follow-up phase asks
 * the persuader for prose and the persona for structure, so one scripted model has to
 * do both within a single simulation.
 */
export const TEST_PLAN: PersuasionPlan = {
  id: 'briefings',
  topic: 'תדריכי בוקר',
  ask: {
    what: 'תדריך בוקר של ארבע דקות',
    withWhom: 'העובדות',
    durationMinutes: 4,
    frequency: 'כל בוקר',
    when: 'לפני הפתיחה',
    script: ['שני פריטים', 'משפט מכירה'],
    trialPeriod: 'שבועיים',
    oneLiner: 'כל בוקר תדריך של ארבע דקות עם העובדות',
  },
  onBehalfOf: { name: 'אושר', title: 'המשנה למנכ"ל', mandate: 'ביקש לקדם תדריכי בוקר' },
  currentStateQuestions: ['מה עושים היום?'],
  arguments: [
    { id: 'a1', category: 'personal_benefit', text: 'תהפכי למנהלת שמפתחת אנשים', strength: 9, why: 'שאפתנית' },
  ],
  objections: [{ objection: 'אין לי זמן', response: 'ארבע דקות זה עשרים בשבוע' }],
  escalation: [
    { rung: 1, message: 'זה קודם כול בשבילך' },
    { rung: 2, message: 'ארבע דקות זה משהו שאני מצפה שנמצא לו מקום' },
    { rung: 3, message: 'הדרכת עובדות היא חלק מהתפקיד' },
    { rung: 4, message: 'נבדוק את זה, ואם לא קורה נבין למה' },
    { rung: 5, message: 'אי ביצוע מתמשך היא שיחה ניהולית אחרת' },
  ],
  stopPoint: 'אחרי ארבע אינטראקציות',
  successCriteria: 'תדריך בכל בוקר',
};

export const TEST_PERSONA: TargetPersona = {
  id: 'adi',
  name: 'עדי',
  role: 'מנהלת חנות',
  resistance: 3,
  reliability: 3,
  situation: 'עמוסה',
  hiddenTruth: 'עושה פעמיים בשבוע',
  motivatedBy: ['הצוות'],
  style: 'ישירה',
  agreesWhen: 'בקשה קטנה ומדויקת',
};

export const PERSUADER_PAYLOAD = {
  blocker: 'overloaded',
  evidence: 'אמרה שאין לה זמן',
  tools: ['אמפתיה'],
  message: 'אושר מבקש תדריך בוקר של ארבע דקות. מתחילים מחר?',
  asksForDecision: true,
  counterpartCommitted: false,
  counterpartRefused: false,
  statesAsk: true,
  statesIdentity: true,
  argumentsUsed: 1,
  setsStartTime: true,
  announcesFollowUp: true,
  signals: { motivatedBy: ['הצוות'], energy: 'medium', autonomyNeed: 'low', respondsToNumbers: null },
};

/** Scripted models for a conversation that ends in agreement. */
export function scriptedAgreement() {
  return {
    persuader: jsonModel([PERSUADER_PAYLOAD]),
    target: textModel(['סגור, אני עושה את זה']),
  };
}

export function makeRun(id: string, overrides: Partial<Run> = {}): Run {
  return {
    id,
    createdAt: `2026-08-19T10:00:0${id.length % 10}.000Z`,
    planId: 'briefings',
    personaId: 'adi',
    plan: TEST_PLAN,
    persona: TEST_PERSONA,
    turns: [],
    state: {
      interaction: 3,
      rung: 2,
      blockers: [],
      fatigue: 0.2,
      outcome: 'agreed',
      askStated: true,
      identityStated: true,
      startTimeSet: true,
      followUpAnnounced: true,
      signals: { motivatedBy: [], energy: 'unknown', autonomyNeed: 'unknown', respondsToNumbers: null },
    },
    violations: [],
    ...overrides,
  };
}
