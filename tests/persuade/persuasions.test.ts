import { describe, expect, it } from 'vitest'
import type { PersuasionPlan, Run } from '../../src/persuade/engine/types'
import { persuasionsFor } from '../../src/persuade/persuasions'

const plan = {
  id: 'gen-retail-ceo-profitability',
  arguments: [
    { id: 'a1', category: 'numbers', text: 'המספרים מראים', strength: 8, why: '' },
    { id: 'a2', category: 'numbers', text: 'עוד מספרים', strength: 6, why: '' },
    { id: 'a3', category: 'authority', text: 'המנכ"ל ביקש', strength: 5, why: '' },
  ],
} as unknown as PersuasionPlan

const run = (
  outcome: string,
  category: string | null,
  sentence: string | null,
  ownPlan: PersuasionPlan = plan,
): Run =>
  ({
    state: { outcome },
    plan: ownPlan,
    score: category
      ? { winningCategory: category, winningArgument: sentence, persuaded: 'yes' }
      : null,
  }) as unknown as Run

describe('annotating what was handed over', () => {
  it('counts a category’s wins against every argument in it', () => {
    const { arguments: args } = persuasionsFor(plan, [
      run('agreed', 'numbers', 'המספרים מראים'),
      run('agreed', 'numbers', 'עוד מספרים'),
    ])

    // Two arguments share the category, so both carry the same count. That is
    // the honest reading: winningArgument is free text the judge wrote and
    // winningCategory is the only typed link back to an argument.
    expect(args.find((a) => a.id === 'a1')?.categoryWins).toBe(2)
    expect(args.find((a) => a.id === 'a2')?.categoryWins).toBe(2)
  })

  it('shows an argument nothing has won on as zero, not as missing', () => {
    // An argument that has never carried a conversation is the most useful row
    // on this screen. Omitting it would hide exactly the finding it is here for.
    const { arguments: args } = persuasionsFor(plan, [run('agreed', 'numbers', 'המספרים מראים')])

    expect(args.find((a) => a.id === 'a3')).toMatchObject({ categoryWins: 0 })
    expect(args).toHaveLength(3)
  })

  it('carries the sentences that actually won', () => {
    const { arguments: args } = persuasionsFor(plan, [run('agreed', 'numbers', 'המספרים מראים')])

    expect(args.find((a) => a.id === 'a1')?.winningSentences).toContain('המספרים מראים')
  })

  it('does not count a refusal as a win', () => {
    // The scorer names the closest thing to a winner even when nothing moved
    // anyone. buildBank already refuses those; this asserts the refusal survives.
    const { arguments: args } = persuasionsFor(plan, [run('refused', 'numbers', 'המספרים מראים')])

    expect(args.every((a) => a.categoryWins === 0)).toBe(true)
  })

  it('reports a category that won but was never written down', () => {
    // The persuader improvised something the plan did not contain and it
    // worked. That is a finding about the plan, not noise.
    const { unwrittenWins } = persuasionsFor(plan, [
      run('agreed', 'less_work_later', 'יחסוך לך זמן אחר כך'),
    ])

    expect(unwrittenWins).toHaveLength(1)
    expect(unwrittenWins[0]).toMatchObject({ category: 'less_work_later', wonCount: 1 })
    expect(unwrittenWins[0]?.categoryLabel).toMatch(/[֐-׿]/)
  })

  it('does not call a regenerated plan’s dropped category "unwritten"', () => {
    // pnpm lab:generate --force upserts a need's plan in place under the same
    // plan_key, so a category an earlier version offered can vanish from the
    // plan this screen fetches live while the run that won it, scored against
    // its OWN plan at the time, stays in the bank forever. The run below won
    // on "authority", which its own (prior) plan offered -- the CURRENT plan
    // (regenerated, "authority" dropped) does not. That must not read as an
    // improvisation.
    const regeneratedPlan = {
      ...plan,
      arguments: plan.arguments.filter((a) => a.category !== 'authority'),
    } as unknown as PersuasionPlan

    const { unwrittenWins } = persuasionsFor(regeneratedPlan, [
      run('agreed', 'authority', 'המנכ"ל ביקש', plan),
    ])

    expect(unwrittenWins.find((w) => w.category === 'authority')).toBeUndefined()
  })

  it('counts how many runs were scored at all', () => {
    // Runs with no score are a different fact from runs that lost, and the
    // screen says which it is looking at.
    const { scoredRuns } = persuasionsFor(plan, [
      run('agreed', 'numbers', 'המספרים מראים'),
      run('agreed', null, null),
    ])

    expect(scoredRuns).toBe(1)
  })

  it('returns the empty shape for a need with no plan', () => {
    expect(persuasionsFor(null, [])).toEqual({
      arguments: [],
      unwrittenWins: [],
      scoredRuns: 0,
    })
  })
})
