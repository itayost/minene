import { describe, expect, test } from 'vitest'
import { defaultConfig, emptyPlan, validateConfig } from '../../src/persuade/engine/config'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { TEST_PLAN } from './helpers'

const good = defaultConfig(TEST_PLAN)

describe('config validation', () => {
  test('a complete config passes', () => {
    expect(validateConfig(good)).toEqual([])
  })

  test('an empty plan is rejected rather than run', () => {
    const problems = validateConfig({ rules: DEFAULT_RULES, plan: emptyPlan() })
    expect(problems.length).toBeGreaterThan(0)
    expect(problems.some((p) => p.field === 'ask')).toBe(true)
  })

  test('a vague ask names exactly what is missing', () => {
    const config = {
      ...good,
      plan: { ...TEST_PLAN, ask: { ...TEST_PLAN.ask, script: [], frequency: '' } },
    }
    const ask = validateConfig(config).find((p) => p.field === 'ask')
    expect(ask?.message).toContain('תדירות')
    expect(ask?.message).toContain('מה אומרים בפועל')
  })

  test('a bot with no arguments is rejected', () => {
    expect(
      validateConfig({ ...good, plan: { ...TEST_PLAN, arguments: [] } }).some(
        (p) => p.field === 'arguments',
      ),
    ).toBe(true)
  })

  test('zero interactions is rejected', () => {
    expect(
      validateConfig({ ...good, rules: { ...DEFAULT_RULES, maxInteractions: 0 } }).some(
        (p) => p.field === 'maxInteractions',
      ),
    ).toBe(true)
  })

  test('a message cap below the sentence cap is rejected', () => {
    expect(
      validateConfig({
        ...good,
        rules: { ...DEFAULT_RULES, maxWordsPerMessage: 5, maxWordsPerSentence: 15 },
      }).some((p) => p.field === 'maxWordsPerMessage'),
    ).toBe(true)
  })

  test('speaking on behalf of nobody in particular is rejected', () => {
    expect(
      validateConfig({
        ...good,
        plan: { ...TEST_PLAN, onBehalfOf: { name: '  ', title: 'x', mandate: 'y' } },
      }).some((p) => p.field === 'onBehalfOf'),
    ).toBe(true)
  })

  test('no mandate at all is fine; the bot speaks for itself', () => {
    expect(validateConfig({ ...good, plan: { ...TEST_PLAN, onBehalfOf: null } })).toEqual([])
  })
})

describe('configurable rules reach the engine', () => {
  test('turning a rule off removes its violation', async () => {
    const { checkTurn, initialState } = await import('../../src/persuade/engine/rules')
    const ctx = {
      plan: TEST_PLAN,
      state: initialState(),
      isGreetingTurn: true,
      statesAsk: false,
      argumentsUsed: 1,
      askedForDecision: false,
    }
    const noMandate = 'שלום, רציתי לדבר איתך על תדריך בוקר'

    expect(
      checkTurn(noMandate, { ...ctx, rules: DEFAULT_RULES }).some(
        (v) => v.rule === 'לא הוצגה שליחות',
      ),
    ).toBe(true)
    expect(
      checkTurn(noMandate, { ...ctx, rules: { ...DEFAULT_RULES, enforceIdentity: false } }),
    ).toHaveLength(0)
  })

  test('a bigger interaction budget is respected', async () => {
    const { shouldStop, initialState } = await import('../../src/persuade/engine/rules')
    const state = { ...initialState(), interaction: 4 }
    expect(shouldStop(state, DEFAULT_RULES).stop).toBe(true)
    expect(shouldStop(state, { ...DEFAULT_RULES, maxInteractions: 8 }).stop).toBe(false)
  })
})

describe('stored config survives only if it still fits', () => {
  test('a config written by this build round-trips', async () => {
    const { readStoredConfig, toStored } = await import('../../src/persuade/engine/config')
    expect(readStoredConfig(toStored(good))?.plan.id).toBe(good.plan.id)
  })

  test('an older shape is discarded rather than half-read', async () => {
    const { readStoredConfig } = await import('../../src/persuade/engine/config')
    // exactly what an earlier build wrote: the bare config, unversioned
    expect(readStoredConfig(JSON.stringify(good))).toBeNull()
  })

  test('a config from a future version is discarded too', async () => {
    const { readStoredConfig, CONFIG_VERSION } = await import('../../src/persuade/engine/config')
    expect(
      readStoredConfig(JSON.stringify({ version: CONFIG_VERSION + 1, config: good })),
    ).toBeNull()
  })

  test('a truncated or corrupt value does not throw', async () => {
    const { readStoredConfig } = await import('../../src/persuade/engine/config')
    expect(readStoredConfig('{"version":2,"config":{"rul')).toBeNull()
    expect(readStoredConfig(null)).toBeNull()
  })

  test('a versioned but structurally broken config is rejected', async () => {
    const { readStoredConfig, CONFIG_VERSION } = await import('../../src/persuade/engine/config')
    const noPlan = { version: CONFIG_VERSION, config: { rules: good.rules } }
    expect(readStoredConfig(JSON.stringify(noPlan))).toBeNull()
  })
})
