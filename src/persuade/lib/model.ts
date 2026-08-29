import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import type { LanguageModel } from 'ai'

/**
 * Model selection through the AI SDK. The provider is picked from whichever key is
 * present, so switching between OpenAI, Anthropic and the Vercel AI Gateway is an
 * env change rather than a code change.
 */

export type ModelRole = 'planner' | 'persuader' | 'target' | 'judge'
export type Provider = 'openai' | 'anthropic' | 'gateway'

/**
 * planner  — stage 0, ranking arguments. Runs once per plan, off the request path.
 * persuader — every turn. Needs to hold the 15-word rule and return valid structure.
 * target   — the counterpart persona.
 */
/**
 * Read at call time, not at module scope.
 *
 * supabase.ts already documents why and this file contradicted it: a
 * module-scope read is evaluated at import, which in a test run happens before
 * any test can set the variables -- so anything overriding PERSUADER_*_MODEL
 * afterwards silently got the stale default.
 */
const defaults = (): Record<Provider, Record<ModelRole, string>> => ({
  openai: {
    planner: process.env.PERSUADER_PLANNER_MODEL ?? 'gpt-5.5',
    judge: process.env.PERSUADER_JUDGE_MODEL ?? 'gpt-5.5',
    persuader: process.env.PERSUADER_MODEL ?? 'gpt-5.5',
    target: process.env.PERSUADER_TARGET_MODEL ?? 'gpt-5.4-mini',
  },
  anthropic: {
    planner: process.env.PERSUADER_PLANNER_MODEL ?? 'claude-opus-5',
    judge: process.env.PERSUADER_JUDGE_MODEL ?? 'claude-opus-5',
    persuader: process.env.PERSUADER_MODEL ?? 'claude-sonnet-5',
    target: process.env.PERSUADER_TARGET_MODEL ?? 'claude-sonnet-5',
  },
  gateway: {
    planner: process.env.PERSUADER_PLANNER_MODEL ?? 'anthropic/claude-opus-5',
    judge: process.env.PERSUADER_JUDGE_MODEL ?? 'anthropic/claude-opus-5',
    persuader: process.env.PERSUADER_MODEL ?? 'anthropic/claude-sonnet-5',
    target: process.env.PERSUADER_TARGET_MODEL ?? 'anthropic/claude-sonnet-5',
  },
})

let overrides: Partial<Record<ModelRole, LanguageModel>> = {}

/** Swap in mock models for tests, or pin a specific model at runtime. */
export function setModelOverrides(next: Partial<Record<ModelRole, LanguageModel>>): void {
  overrides = next
}

export function activeProvider(): Provider {
  const forced = process.env.PERSUADER_PROVIDER
  if (forced === 'openai' || forced === 'anthropic' || forced === 'gateway') return forced
  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  return 'gateway'
}

export function modelId(role: ModelRole): string {
  return defaults()[activeProvider()][role]
}

export function model(role: ModelRole): LanguageModel {
  const override = overrides[role]
  if (override) return override

  const id = modelId(role)
  switch (activeProvider()) {
    case 'openai':
      return openai(id)
    case 'anthropic':
      return anthropic(id)
    default:
      // Bare "provider/model" strings resolve through the Vercel AI Gateway.
      return id
  }
}

/**
 * Reasoning effort per role, tuned for a conversation someone is waiting on.
 *
 * The field report that prompted this said "זמן התגובה בלתי אפשרי". Two of
 * these three roles sit directly between a manager pressing שליחה and a message
 * appearing, and on a reasoning model the thinking budget is most of that wait.
 *
 * planner is `low` because it is no longer inventing: with ammunition it is
 * decomposing and ranking material the business already approved and already
 * rated, and `applyMeasuredStrength` overwrites its scores afterwards anyway.
 * persuader is `low` because the hard thinking has been moved into code -- the
 * blocker table, the rung ladder and the rule checks are all deterministic, and
 * the model's remaining job is to write one short Hebrew sentence.
 * judge is absent on purpose: scoring runs offline in the lab, nobody waits on
 * it, and it is the one role where depth is worth its seconds.
 *
 * target is `low` rather than anything lower. It was `minimal`, which the SDK's
 * own type accepts and `gpt-5.4-mini` -- this role's default model -- rejects
 * outright: "Unsupported value: 'minimal' is not supported with the
 * 'gpt-5.4-mini' model." Every persona reply in the lab threw. `none` is
 * supported and would be faster still, but the counterpart is the side that
 * decides whether `agreesWhen` was met, and that decision becomes the run's
 * outcome, which the matrix and the bank are computed from. Saving a second in
 * an internal lab is not worth quietly degrading the measurement.
 */
const effort = (): Partial<Record<ModelRole, string>> => ({
  planner: process.env.PERSUADER_PLANNER_EFFORT ?? 'low',
  persuader: process.env.PERSUADER_EFFORT ?? 'low',
  target: process.env.PERSUADER_TARGET_EFFORT ?? 'low',
})

/**
 * The values a model will actually accept, which is narrower than the values
 * the SDK's type will.
 *
 * `LanguageModelV3`'s union includes `minimal` and `max`; gpt-5.4-mini accepts
 * neither, and sending one is a hard 400 that fails the whole call rather than
 * a warning. Since these are env-settable, a typo or a model swap would break
 * conversations in production for a setting whose entire purpose is to shave
 * seconds off them -- so an unrecognised value is dropped and the model's own
 * default stands. Validating external input at the boundary, which is what an
 * env var is.
 */
const SUPPORTED_EFFORT = new Set(['none', 'low', 'medium', 'high', 'xhigh'])

/**
 * A ceiling, not a target.
 *
 * Message length is enforced by `rules.maxWordsPerMessage` in code, which is
 * where it belongs. This exists so a model that ignores its instructions costs
 * a bounded number of seconds instead of an unbounded one. On the OpenAI
 * Responses API reasoning tokens count against this budget too, so these are
 * set generously: a truncated structured object is a failed turn, which is a
 * far worse outcome than a slow one.
 */
const OUTPUT_CAP: Record<ModelRole, number> = {
  planner: 8000,
  persuader: 2000,
  target: 1000,
  judge: 4000,
}

export interface CallOptions {
  maxOutputTokens: number
  providerOptions?: Record<string, Record<string, string>>
}

/**
 * The speed settings for one role, spread into a generate/stream call.
 *
 * Provider options are namespaced by provider and ignored by the others, but
 * they are only emitted for the provider that understands them: an unknown
 * option is a warning rather than an error, and a warning nobody reads is how
 * a setting silently stops applying.
 */
export function callOptions(role: ModelRole): CallOptions {
  const chosen = effort()[role]
  const provider = activeProvider()
  const cap = { maxOutputTokens: OUTPUT_CAP[role] }

  // Overrides mean a scripted model in a test. It has no provider to configure
  // and no budget to spend, and passing either would make every mock assert
  // against options that exist for nobody's benefit.
  if (overrides[role] || !chosen || !SUPPORTED_EFFORT.has(chosen)) return cap

  // The gateway forwards provider options under the upstream provider's own
  // key, so both paths name the model's real provider rather than 'gateway'.
  const upstream = provider === 'gateway' ? (modelId(role).split('/')[0] ?? 'openai') : provider
  if (upstream !== 'openai') return cap

  return { ...cap, providerOptions: { openai: { reasoningEffort: chosen } } }
}

export function assertModelAccessConfigured(): void {
  if (Object.keys(overrides).length > 0) return
  if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) return
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) return

  throw new Error(
    'אין גישה למודל. הוסף ל-.env.local את OPENAI_API_KEY, או ANTHROPIC_API_KEY, או AI_GATEWAY_API_KEY.',
  )
}
