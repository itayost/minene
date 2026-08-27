import { describe, expect, it } from 'vitest'
import { computeRates } from '../../src/persuade/engine/rates'
import type { Run } from '../../src/persuade/engine/types'

const run = ({ outcome = 'refused', executed = null, blockers = [], interaction = 3, category = null }: {
  outcome?: string
  executed?: 'yes' | 'no' | 'partial' | null
  blockers?: string[]
  interaction?: number
  category?: string | null
} = {}) => ({
  id: `r-${Math.random()}`,
  personaId: 'rona',
  state: { outcome, blockers, interaction },
  violations: [],
  ...(executed ? { followUp: { report: { executed } } } : {}),
  ...(category ? { score: { winningCategory: category } } : {}),
}) as unknown as Run

describe('the two rates, and why they never merge', () => {
  it('keeps the denominators apart', () => {
    const runs = [
      run({ outcome: 'agreed', executed: 'yes' }),
      run({ outcome: 'agreed', executed: 'no' }),
      run(),
      run(),
    ]
    const rates = computeRates(runs)

    // Out of 100 conversations, how many said yes -- and out of 100 who said
    // yes, how many actually did it. Two questions, two denominators, never one
    // number.
    expect(rates.persuasionRate).toBe(50)
    expect(rates.executionRate).toBe(50)
  })

  it('reports no execution rate at all when nobody agreed', () => {
    const rates = computeRates([run(), run()])

    // Zero agreements means the execution denominator is zero. That is "no
    // data", not 0% -- the same null-is-not-zero rule the brain's rating
    // follows, and a deliberate change from the recovered code, which returned
    // 0 and so reported total failure where there was nothing to report.
    expect(rates.executionRate).toBeNull()
  })

  it('counts a partial execution as not done', () => {
    const rates = computeRates([run({ outcome: 'agreed', executed: 'partial' })])

    // Otherwise the measurement drifts upward one generous rounding at a time.
    expect(rates.executionRate).toBe(0)
  })

  it('reports a blocker’s break rate, not merely how often it appeared', () => {
    const rates = computeRates([
      run({ outcome: 'agreed', blockers: ['overloaded'] }),
      run({ outcome: 'refused', blockers: ['overloaded'] }),
    ])

    // "Encountered 26 times" is not actionable. "Broken in 19 of 26" is.
    expect(rates.byBlocker[0]).toEqual({ blocker: 'overloaded', encountered: 2, overcome: 1 })
  })

  it('says nothing rather than zero when there are no runs at all', () => {
    const rates = computeRates([])

    expect(rates.persuasionRate).toBeNull()
    expect(rates.executionRate).toBeNull()
  })
})
