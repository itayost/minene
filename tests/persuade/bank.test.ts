import { describe, expect, it } from 'vitest'
import { blockersIn, buildBank } from '../../src/persuade/bank'
import type { Run } from '../../src/persuade/engine/types'

const run = ({
  outcome = 'agreed',
  category = null,
  argument = null,
  grade = 70,
  blockers = [],
}: {
  outcome?: string
  category?: string | null
  argument?: string | null
  grade?: number
  blockers?: string[]
} = {}) =>
  ({
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
    const blockers = blockersIn([
      run({ outcome: 'agreed', blockers: ['overloaded', 'overloaded'] }),
    ])

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

  it('does not credit every blocker in a run for a win only one of them earned', () => {
    // Two distinct blockers were diagnosed in the same conversation, which then
    // ended in agreement. Nothing in the data says which of the two the
    // agreement is actually attributable to -- `state.blockers` only ever grows,
    // it never records which one was resolved. Crediting both as "overcome"
    // states a fact ("this specific blocker was broken") the run cannot support.
    const blockers = blockersIn([run({ outcome: 'agreed', blockers: ['overloaded', 'no_price'] })])

    const overloaded = blockers.find((b) => b.blocker === 'overloaded')
    const noPrice = blockers.find((b) => b.blocker === 'no_price')
    expect(overloaded).toMatchObject({ encountered: 1, overcome: 0 })
    expect(noPrice).toMatchObject({ encountered: 1, overcome: 0 })
  })

  it('does not report no_reply as a blocker at all', () => {
    // `no_reply` is set on the persuader's own turn whenever the immediately
    // preceding target turn was silent (engine/prompts.ts's silenceNote: "סמן
    // blocker כ-no_reply") -- it is not a diagnosis read out of anything the
    // counterpart said, it is what the field holds when there is nothing to
    // read. types.ts says as much about BlockerId's own 'no_reply' entry: "there
    // is nothing to read here". Reporting it beside 'afraid' or 'overloaded'
    // states a psychological obstacle that was never actually diagnosed.
    const blockers = blockersIn([run({ outcome: 'agreed', blockers: ['no_reply'] })])

    expect(blockers.find((b) => b.blocker === 'no_reply')).toBeUndefined()
  })

  it('does not let a silent opener block credit for the blocker that actually was overcome', () => {
    // `slow` responsiveness ignores exactly the opening message, so `no_reply`
    // lands in `state.blockers` on nearly every such run before the
    // conversation has said anything real -- see world.ts's RESPONSIVENESS
    // and staysSilent. `state.blockers` only ever grows, so it stays there for
    // the rest of the run. Left in the ambiguity check, it makes an otherwise
    // single-blocker, unambiguously-agreed run read as two blockers and
    // silently withholds credit from the one that was actually diagnosed and
    // broken.
    const blockers = blockersIn([run({ outcome: 'agreed', blockers: ['no_reply', 'overloaded'] })])

    expect(blockers.find((b) => b.blocker === 'overloaded')).toMatchObject({
      encountered: 1,
      overcome: 1,
    })
  })
})
