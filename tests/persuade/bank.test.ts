import { describe, expect, it } from 'vitest'
import { buildBank, blockersIn } from '../../src/persuade/bank'
import type { Run } from '../../src/persuade/engine/types'

const run = ({ outcome = 'agreed', category = null, argument = null, grade = 70, blockers = [] }: {
  outcome?: string
  category?: string | null
  argument?: string | null
  grade?: number
  blockers?: string[]
} = {}) => ({
  id: `r-${Math.random()}`,
  state: { outcome, blockers, interaction: 3 },
  violations: [],
  ...(category ? { score: { winningCategory: category, winningArgument: argument, grade } } : {}),
}) as unknown as Run

describe('the bank, derived rather than stored', () => {
  it('counts only the arguments that actually won', () => {
    const bank = buildBank([
      run({ outcome: 'agreed', category: 'less_work_later' }),
      run({ outcome: 'agreed', category: 'less_work_later' }),
      run({ outcome: 'refused', category: 'less_work_later' }),
    ])

    // A losing run can still name a winning category -- the scorer reports what
    // moved the person, and in a refusal nothing did. Counting those would make
    // the bank a record of what was tried.
    expect(bank[0]).toMatchObject({ category: 'less_work_later', wonCount: 2 })
  })

  it('ranks by wins, not by how often an argument was reached for', () => {
    const bank = buildBank([
      ...Array.from({ length: 20 }, () => run({ outcome: 'refused', category: 'numbers' })),
      ...Array.from({ length: 3 }, () => run({ outcome: 'agreed', category: 'numbers' })),
      ...Array.from({ length: 5 }, () => run({ outcome: 'agreed', category: 'social_proof' })),
    ])

    expect(bank[0]?.category).toBe('social_proof')
    expect(bank[1]?.category).toBe('numbers')
  })

  it('keeps the sentence that won, not only its category', () => {
    const bank = buildBank([
      run({ category: 'numbers', argument: 'פי שלוש למידה לעובדות, על אותה משמרת.' }),
    ])

    // A category tells an owner which lever works. The sentence is what they
    // can actually say tomorrow morning.
    expect(bank[0]?.examples).toContain('פי שלוש למידה לעובדות, על אותה משמרת.')
  })

  it('is empty rather than wrong when nothing has been scored', () => {
    // A run nobody has judged carries no winning category. Treating that as a
    // win for some default would invent findings out of unscored work.
    expect(buildBank([run({ category: null })])).toEqual([])
  })
})

describe('what stopped the conversations', () => {
  it('reports a blocker’s break rate, not merely its frequency', () => {
    const blockers = blockersIn([
      run({ outcome: 'agreed', blockers: ['overloaded'] }),
      run({ outcome: 'agreed', blockers: ['overloaded'] }),
      run({ outcome: 'refused', blockers: ['overloaded'] }),
    ])

    // "Encountered 26 times" is not actionable. "Broken in 19 of 26" is.
    expect(blockers[0]).toEqual({ blocker: 'overloaded', encountered: 3, overcome: 2 })
  })

  it('counts a blocker once per conversation, however often it recurred', () => {
    const blockers = blockersIn([run({ outcome: 'agreed', blockers: ['overloaded', 'overloaded'] })])

    // Otherwise a single stubborn conversation outvotes ten straightforward
    // ones, and the ranking measures repetition rather than incidence.
    expect(blockers[0]?.encountered).toBe(1)
  })

  it('leads with what is hit most, so the worst obstacle is first', () => {
    const blockers = blockersIn([
      run({ blockers: ['afraid'] }),
      run({ blockers: ['overloaded'] }),
      run({ blockers: ['overloaded'] }),
    ])

    expect(blockers[0]?.blocker).toBe('overloaded')
  })
})
