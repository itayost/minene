/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { callOptions, setModelOverrides } from '../../src/persuade/lib/model';
import { jsonModel } from './helpers';

/**
 * The third lever on response time, after caching the plan and streaming the
 * message: how long the model is allowed to think before it starts.
 *
 * Two of these roles sit directly between a manager pressing שליחה and a message
 * appearing, and on a reasoning model the thinking budget is most of that wait.
 * The hard thinking in this engine is not the model's anyway -- the blocker
 * table, the rung ladder and the rule checks are all deterministic code.
 */

const ENV = { ...process.env };

beforeEach(() => {
  delete process.env.PERSUADER_PROVIDER;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.PERSUADER_EFFORT;
  process.env.OPENAI_API_KEY = 'test-key';
});

afterEach(() => {
  process.env = { ...ENV };
  setModelOverrides({});
});

describe('speed settings per role', () => {
  test('keeps the roles someone is waiting on at a low thinking budget', () => {
    expect(callOptions('persuader').providerOptions?.openai?.reasoningEffort).toBe('low');
    expect(callOptions('planner').providerOptions?.openai?.reasoningEffort).toBe('low');
    expect(callOptions('target').providerOptions?.openai?.reasoningEffort).toBe('minimal');
  });

  test('leaves the judge alone, because nobody is waiting on a score', () => {
    // Scoring runs offline in the lab. It is the one role where depth is worth
    // its seconds, so it keeps the model's own default rather than being
    // hurried along with the rest.
    expect(callOptions('judge').providerOptions).toBeUndefined();
  });

  test('is overridable without a deploy', () => {
    // The whole point of an env var here: if the shorter thinking budget costs
    // quality on real conversations, it is turned back up from the dashboard
    // rather than from a pull request.
    process.env.PERSUADER_EFFORT = 'high';
    expect(callOptions('persuader').providerOptions?.openai?.reasoningEffort).toBe('high');
  });

  test('caps output for every role', () => {
    // A ceiling rather than a target. Message length is enforced by
    // rules.maxWordsPerMessage in code, where it belongs; this only stops a
    // model that ignores its instructions from costing unbounded seconds.
    for (const role of ['planner', 'persuader', 'target', 'judge'] as const) {
      expect(callOptions(role).maxOutputTokens).toBeGreaterThan(0);
    }
  });

  test('sends nothing provider-specific to a provider that would not understand it', () => {
    // An unknown provider option is a warning, not an error, and a warning
    // nobody reads is how a setting silently stops applying.
    process.env.PERSUADER_PROVIDER = 'anthropic';
    expect(callOptions('persuader').providerOptions).toBeUndefined();
  });

  test('names the upstream provider when running through the gateway', () => {
    // The gateway forwards provider options under the real provider's key, so
    // 'gateway' is never the right name to send them under.
    process.env.PERSUADER_PROVIDER = 'gateway';
    process.env.PERSUADER_MODEL = 'openai/gpt-5.5';
    expect(callOptions('persuader').providerOptions?.openai?.reasoningEffort).toBe('low');
  });

  test('sends no provider options to a scripted model in a test', () => {
    // A mock has no provider to configure and no budget to spend. Passing them
    // anyway would make every test assert against options that exist for
    // nobody's benefit.
    setModelOverrides({ persuader: jsonModel([{}]) });
    expect(callOptions('persuader').providerOptions).toBeUndefined();
  });
});
