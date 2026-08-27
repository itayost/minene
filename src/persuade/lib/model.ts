import { anthropic } from '@ai-sdk/anthropic';
import { openai } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';

/**
 * Model selection through the AI SDK. The provider is picked from whichever key is
 * present, so switching between OpenAI, Anthropic and the Vercel AI Gateway is an
 * env change rather than a code change.
 */

export type ModelRole = 'planner' | 'persuader' | 'target';
export type Provider = 'openai' | 'anthropic' | 'gateway';

/**
 * planner  — stage 0, ranking arguments. Runs once per plan, off the request path.
 * persuader — every turn. Needs to hold the 15-word rule and return valid structure.
 * target   — the counterpart persona.
 */
const DEFAULTS: Record<Provider, Record<ModelRole, string>> = {
  openai: {
    planner: process.env.PERSUADER_PLANNER_MODEL ?? 'gpt-5.5',
    persuader: process.env.PERSUADER_MODEL ?? 'gpt-5.5',
    target: process.env.PERSUADER_TARGET_MODEL ?? 'gpt-5.4-mini',
  },
  anthropic: {
    planner: process.env.PERSUADER_PLANNER_MODEL ?? 'claude-opus-5',
    persuader: process.env.PERSUADER_MODEL ?? 'claude-sonnet-5',
    target: process.env.PERSUADER_TARGET_MODEL ?? 'claude-sonnet-5',
  },
  gateway: {
    planner: process.env.PERSUADER_PLANNER_MODEL ?? 'anthropic/claude-opus-5',
    persuader: process.env.PERSUADER_MODEL ?? 'anthropic/claude-sonnet-5',
    target: process.env.PERSUADER_TARGET_MODEL ?? 'anthropic/claude-sonnet-5',
  },
};

let overrides: Partial<Record<ModelRole, LanguageModel>> = {};

/** Swap in mock models for tests, or pin a specific model at runtime. */
export function setModelOverrides(next: Partial<Record<ModelRole, LanguageModel>>): void {
  overrides = next;
}

export function activeProvider(): Provider {
  const forced = process.env.PERSUADER_PROVIDER;
  if (forced === 'openai' || forced === 'anthropic' || forced === 'gateway') return forced;
  if (process.env.OPENAI_API_KEY) return 'openai';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'gateway';
}

export function modelId(role: ModelRole): string {
  return DEFAULTS[activeProvider()][role];
}

export function model(role: ModelRole): LanguageModel {
  const override = overrides[role];
  if (override) return override;

  const id = modelId(role);
  switch (activeProvider()) {
    case 'openai':
      return openai(id);
    case 'anthropic':
      return anthropic(id);
    default:
      // Bare "provider/model" strings resolve through the Vercel AI Gateway.
      return id;
  }
}

export function assertModelAccessConfigured(): void {
  if (Object.keys(overrides).length > 0) return;
  if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) return;
  if (process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN) return;

  throw new Error(
    'אין גישה למודל. הוסף ל-.env.local את OPENAI_API_KEY, או ANTHROPIC_API_KEY, או AI_GATEWAY_API_KEY.',
  );
}
