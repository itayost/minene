/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import type { TechniqueReport } from '../../src/persuade/effectiveness'
import { promote, propose, readPromoted } from '../../src/persuade/lib/technique-weights'

const report = (
  category: string,
  winPct: number | null,
  runs = 20,
  negativeReactionPct: number | null = 0,
): TechniqueReport =>
  ({
    category,
    runs,
    wins: Math.round((runs * (winPct ?? 0)) / 100),
    winPct,
    avgMessagesToWin: 3,
    negativeReactionPct,
    byReason: [{ key: 'forgot', runs, wins: 1, winPct }],
    byPersona: [],
  }) as TechniqueReport

/**
 * The property this whole file exists for. Everything else is arithmetic.
 */
describe('the gate between the lab and what the bot believes', () => {
  it('has no function that promotes without a person', () => {
    // Structural, not conventional: `promote` takes promotedBy as a required
    // argument, so there is no call that could be put on a schedule and quietly
    // change what a real employee hears.
    expect(promote.length).toBeGreaterThanOrEqual(3)

    const source = readFileSync(
      new URL('../../src/persuade/lib/technique-weights.ts', import.meta.url),
      'utf8',
    )
    // propose() must not write. If it ever gains an insert, the arrow the
    // architecture drew straight back into the rules DB has been rebuilt here.
    const proposeFn = source.slice(
      source.indexOf('export function propose'),
      source.indexOf('interface WeightRow'),
    )
    expect(proposeFn).not.toMatch(/\.from\(|insert|upsert/)
  })

  it('hides a proposal nobody accepted', async () => {
    const filters: Record<string, unknown> = {}
    const client = {
      from: () => ({
        select: () => ({
          not: (column: string, op: string, value: unknown) => {
            filters.not = `${column} ${op} ${value}`
            return {
              eq: () => ({ data: [], error: null }),
            }
          },
        }),
      }),
    } as unknown as SupabaseClient

    await readPromoted(client, { industry: 'retail' })

    // The gate is this filter. Insert a thousand suggestions and production
    // still reads none of them.
    expect(filters.not).toBe('promoted_at is null')
  })

  it('widens a row with a null reason to every reason', async () => {
    const rows = [
      { industry: 'retail', job_role_name: null, reason: null, category: 'numbers', weight: 1.4 },
      {
        industry: 'retail',
        job_role_name: null,
        reason: 'forgot',
        category: 'authority',
        weight: 0.5,
      },
    ]
    const client = {
      from: () => ({
        select: () => ({ not: () => ({ eq: () => ({ data: rows, error: null }) }) }),
      }),
    } as unknown as SupabaseClient

    const forDisagrees = await readPromoted(client, { industry: 'retail', reason: 'disagrees' })

    // The general finding applies; the one scoped to "forgot" does not.
    expect(forDisagrees.map((w) => w.category)).toEqual(['numbers'])
  })
})

describe('turning evidence into a suggestion', () => {
  it('scores a technique against its peers, not against an absolute', () => {
    // A 20% win rate is good in a hard cell and poor in an easy one. Only the
    // comparison survives the difference.
    const proposals = propose([report('numbers', 60), report('authority', 20)])

    const numbers = proposals.find((p) => p.category === 'numbers')!
    const authority = proposals.find((p) => p.category === 'authority')!
    expect(numbers.weight).toBeGreaterThan(1)
    expect(authority.weight).toBeLessThan(1)
  })

  it('weights the peer average by evidence, not by counting each technique once', () => {
    // Two techniques with a thousand runs each at the same 40% rate are the real
    // peer average. A third technique's two lucky runs at 100% should not be
    // able to drag that baseline up and make the well-evidenced techniques read
    // as underperforming their peers when they ARE the peers.
    const proposals = propose([
      report('numbers', 40, 1000),
      report('authority', 40, 1000),
      report('social_proof', 100, 2),
    ])

    const numbers = proposals.find((p) => p.category === 'numbers')!
    const authority = proposals.find((p) => p.category === 'authority')!

    expect(numbers.weight).toBeGreaterThan(0.9)
    expect(authority.weight).toBeGreaterThan(0.9)
  })

  it('scores a technique against its actual peers, not against a baseline it dominates', () => {
    // "numbers" ran 900 times and won 20%. "authority" ran only 100 times but
    // won 60%. The peer group for "numbers" is authority alone -- pooling
    // numbers' own 900 runs into its own baseline lets a technique that ran
    // most of the volume drag the bar down to meet itself, so a technique
    // that is genuinely a third as good as its peer (20 vs 60) reads as only
    // mildly below "average" instead of clearly underperforming it.
    const proposals = propose([report('numbers', 20, 900), report('authority', 60, 100)])
    const numbers = proposals.find((p) => p.category === 'numbers')!

    expect(numbers.weight).toBeLessThan(0.5)
  })

  it('rates a technique above average when its peer has genuinely never won', () => {
    // As the peer average approaches zero from above, the ratio climbs toward
    // the ceiling: a peer winning just 2 of 50 already earns "numbers" the max
    // weight (see the next test). But `average === 0` is special-cased back to
    // a neutral ratio of 1, so at the one point where the peer's evidence is
    // strongest -- a real 0% across 50 runs, not a thin sample -- the technique
    // that wins 90% of the time reads as merely "average" instead of the clear
    // best. Genuinely tied evidence (both at 0%) should stay neutral; this
    // is not that case.
    const proposals = propose([report('numbers', 90, 50), report('authority', 0, 50)])
    const numbers = proposals.find((p) => p.category === 'numbers')!
    expect(numbers.weight).toBeGreaterThan(1)
  })

  it('still rates two techniques that both never won as neutral, not favoring either', () => {
    const proposals = propose([report('numbers', 0, 50), report('authority', 0, 50)])
    expect(proposals.every((p) => p.weight === 1)).toBe(true)
  })

  it('carries the evidence, so a promotion can record what it was based on', () => {
    const [proposal] = propose([report('numbers', 60, 42)])
    expect(proposal!.evidence).toEqual({ runs: 42, winPct: 60, negativeReactionPct: 0 })
  })

  it('says out loud when a suggestion is weak', () => {
    const thin = propose([report('numbers', 60, 3), report('authority', 20, 3)])
    expect(thin[0]!.caveat).toMatch(/3 ריצות בלבד/)

    const harsh = propose([report('numbers', 60, 40, 45), report('authority', 20, 40)])
    expect(harsh.find((p) => p.category === 'numbers')!.caveat).toMatch(/עייפות/)
  })

  it('flags a whole set built from runs with no world', () => {
    const worldless = { ...report('numbers', 60), byReason: [] } as TechniqueReport
    expect(propose([worldless, report('authority', 20)])[0]!.caveat).toMatch(/בלי עולם/)
  })

  it('flags a technique whose runs are only PARTLY covered by a world', () => {
    // 20 runs total, byReason only accounts for 12 of them: 8 ran without a
    // world and are pooled into the same winPct as a different, incomparable
    // population -- the exact failure technique-report.ts already guards
    // against at the dataset level ("four pre-world refusals and seven world
    // runs that agreed 86% of the time, averaged to a number describing
    // neither"). `byReason.length === 0` only catches the all-or-nothing case
    // and misses this partial mix, so today it says nothing.
    const partiallyWorldless = {
      ...report('numbers', 60, 20),
      byReason: [{ key: 'forgot', runs: 12, wins: 7, winPct: 58 }],
    } as TechniqueReport

    const [proposal] = propose([partiallyWorldless])
    expect(proposal!.caveat).toMatch(/בלי עולם/)
  })

  it('ignores a technique nothing is known about', () => {
    expect(propose([report('numbers', null)])).toEqual([])
  })

  it('never proposes a weight outside what the column allows', () => {
    // The check constraint is 0..3; a proposal that violates it fails on
    // insert, which is a promotion that breaks at the worst moment.
    const lopsided = propose([report('numbers', 100), report('authority', 1)])
    for (const p of lopsided) {
      expect(p.weight).toBeGreaterThanOrEqual(0)
      expect(p.weight).toBeLessThanOrEqual(3)
    }
  })
})
