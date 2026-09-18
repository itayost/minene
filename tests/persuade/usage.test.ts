/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test } from 'vitest'
import { scoreRun } from '../../src/persuade/engine/score'
import { runSimulation } from '../../src/persuade/engine/simulation'
import type { Run } from '../../src/persuade/engine/types'
import { createUsageMeter, recordUsage, withUsageMeter } from '../../src/persuade/engine/usage'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { jsonModel, scriptedAgreement, TEST_PERSONA, TEST_PLAN } from './helpers'

afterEach(() => setModelOverrides({}))

const SCORE = {
  persuaded: 'yes',
  winningArgument: null,
  winningCategory: null,
  mainObjection: null,
  whatBrokeIt: null,
  whatFailed: null,
  grade: 80,
  notes: 'בסדר',
  responseValidity: 'did',
}

describe('usage meter', () => {
  test('sums every model call in a run, judge included', async () => {
    // Every scripted call reports 10 input and 10 output tokens.
    setModelOverrides({ ...scriptedAgreement(), judge: jsonModel([SCORE]) })
    const meter = createUsageMeter()

    await withUsageMeter(meter, async () => {
      let run: Run | null = null
      for await (const event of runSimulation({ plan: TEST_PLAN, persona: TEST_PERSONA })) {
        if (event.type === 'done') run = event.run
      }
      if (!run) throw new Error('no run')
      await scoreRun(run.plan, run.turns, run.state, run.violations)
    })

    // scriptedAgreement ends after one persuader turn and one reply.
    expect(meter.totals()).toEqual({
      persuader: { input: 10, output: 10 },
      target: { input: 10, output: 10 },
      judge: { input: 10, output: 10 },
    })
  })

  test('keeps concurrent runs apart', async () => {
    const a = createUsageMeter()
    const b = createUsageMeter()
    const tickThenRecord = async (tokens: number) => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      recordUsage('persuader', { inputTokens: tokens, outputTokens: tokens })
    }

    await Promise.all([
      withUsageMeter(a, () => tickThenRecord(1)),
      withUsageMeter(b, () => tickThenRecord(5)),
    ])

    expect(a.totals().persuader).toEqual({ input: 1, output: 1 })
    expect(b.totals().persuader).toEqual({ input: 5, output: 5 })
  })

  test('recording outside a meter is a no-op, so the chat route is unaffected', () => {
    expect(() => recordUsage('target', { inputTokens: 3, outputTokens: 3 })).not.toThrow()
  })

  test('treats missing counts as zero rather than NaN', () => {
    const meter = createUsageMeter()
    meter.record('judge', { inputTokens: undefined, outputTokens: 4 })
    meter.record('judge', undefined)
    expect(meter.totals().judge).toEqual({ input: 0, output: 4 })
  })
})
