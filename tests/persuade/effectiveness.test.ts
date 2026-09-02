/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import {
  buildEffectiveness,
  distinctModelFingerprints,
  type EffectivenessInput,
  formatTechnique,
} from '../../src/persuade/effectiveness'
import type { ArgumentCategory, RunScore, Turn } from '../../src/persuade/engine/types'
import { buildWorld } from '../../src/persuade/engine/world'

const world = (reason: Parameters<typeof buildWorld>[0]['reason']) =>
  buildWorld({
    motivation: 'medium',
    workload: 'normal',
    reason,
    pressureResponse: 'withdraws',
    disposition: 'rational',
  })

const turns = (n: number): Turn[] =>
  Array.from({ length: n }, () => ({ role: 'persuader' as const, text: 'x', interaction: 1 }))

const input = (
  outcome: string,
  winning: ArgumentCategory | null,
  reason: Parameters<typeof world>[0],
  personaId: string,
  offered: ArgumentCategory[] = ['personal_benefit', 'social_proof'],
  fatigue = 0,
): EffectivenessInput => ({
  run: {
    outcome: outcome as EffectivenessInput['run']['outcome'],
    turns: turns(3),
    score: winning === null ? null : ({ winningCategory: winning } as RunScore),
    world: world(reason),
    personaId,
    fatigue,
  },
  offered,
})

describe('what a technique report says', () => {
  test('credits a win only to the category the scorer named', () => {
    const reports = buildEffectiveness([
      input('agreed', 'personal_benefit', 'no_value', 'adi'),
      input('agreed', 'personal_benefit', 'no_value', 'adi'),
      input('refused', 'social_proof', 'no_value', 'adi'),
    ])

    const personal = reports.find((r) => r.category === 'personal_benefit')!
    const social = reports.find((r) => r.category === 'social_proof')!

    // Both were on the table all three times, so both have three runs. Only
    // personal_benefit was ever named as what moved the person.
    expect(personal.runs).toBe(3)
    expect(social.runs).toBe(3)
    expect(personal.wins).toBe(2)
    expect(social.wins).toBe(0)
  })

  test('a losing run never credits the category the scorer mentioned', () => {
    // The scorer names the closest thing to a winner even in a refusal, which
    // is a different claim from "this worked". Counting it would make the
    // numerator and denominator measure unrelated things.
    const reports = buildEffectiveness([input('refused', 'social_proof', 'disagrees', 'adi')])
    expect(reports.find((r) => r.category === 'social_proof')!.wins).toBe(0)
  })

  test('slices by the reason the thing had not happened', () => {
    const reports = buildEffectiveness([
      input('agreed', 'personal_benefit', 'no_value', 'adi'),
      input('agreed', 'personal_benefit', 'no_value', 'adi'),
      input('refused', null, 'disagrees', 'adi'),
      input('refused', null, 'disagrees', 'adi'),
    ])

    const byReason = reports.find((r) => r.category === 'personal_benefit')!.byReason
    // The read the whole thing exists for: naming a personal benefit moves
    // someone who sees no value, and does nothing for someone who disagrees.
    expect(byReason.find((s) => s.key === 'no_value')?.winPct).toBe(100)
    expect(byReason.find((s) => s.key === 'disagrees')?.winPct).toBe(0)
  })

  test('slices by persona too', () => {
    const reports = buildEffectiveness([
      input('agreed', 'personal_benefit', 'forgot', 'adi'),
      input('refused', null, 'forgot', 'rona'),
    ])

    const byPersona = reports.find((r) => r.category === 'personal_benefit')!.byPersona
    expect(byPersona.find((s) => s.key === 'adi')?.winPct).toBe(100)
    expect(byPersona.find((s) => s.key === 'rona')?.winPct).toBe(0)
  })

  test('counts a worn-down counterpart against the technique that was in play', () => {
    // A technique that wins half the time and exhausts the other half is not a
    // fifty percent technique; it is one with a cost nobody counted.
    const reports = buildEffectiveness([
      input('agreed', 'personal_benefit', 'no_time', 'adi', ['personal_benefit'], 0),
      input('refused', null, 'no_time', 'adi', ['personal_benefit'], 0.9),
    ])

    expect(reports[0]!.negativeReactionPct).toBe(50)
  })

  test('counts a run that literally stopped from fatigue as a negative reaction', () => {
    // fatigueThreshold is a per-run RuleConfig setting (see experiments.ts),
    // and an experiment is free to run it below the 0.7 default. A run whose
    // outcome is 'stopped_fatigue' ended because the engine's OWN threshold
    // was crossed -- the ground truth for "worn down" -- regardless of
    // whether that score also clears the fixed 0.7 bar this report checks.
    const reports = buildEffectiveness([
      input('stopped_fatigue', null, 'no_time', 'adi', ['personal_benefit'], 0.4),
    ])
    expect(reports[0]!.negativeReactionPct).toBe(100)
  })

  test('an agreed run with no score counts as neither a win nor a loss', () => {
    // The scorer can fail after a conversation ends in agreement -- the route
    // stores the run anyway, with `score: null` (see app/api/persuade/
    // simulate/route.ts). That run genuinely proves nothing about which
    // offered category moved the person: it is not evidence the technique
    // failed, only evidence nobody got to judge it. Counting it as a loss for
    // every category the plan offered is the same "0 where the honest answer
    // is null" mistake `pct()` exists to prevent, just reached a different way.
    const reports = buildEffectiveness([
      input('agreed', 'personal_benefit', 'no_value', 'adi', ['personal_benefit']),
      input('agreed', null, 'no_value', 'adi', ['personal_benefit']),
    ])

    const personal = reports.find((r) => r.category === 'personal_benefit')!
    expect(personal.runs).toBe(1)
    expect(personal.wins).toBe(1)
    expect(personal.winPct).toBe(100)
  })

  test('an unscored agreed run still counts toward exhaustion, on its own denominator', () => {
    // Sitting out the win/loss count is not the same as never having happened:
    // the fatigue signal comes straight off the run, not off the scorer, so an
    // unscored run that ran the counterpart ragged still belongs in this rate.
    const reports = buildEffectiveness([
      input('agreed', null, 'no_value', 'adi', ['personal_benefit'], 0.9),
    ])

    const personal = reports.find((r) => r.category === 'personal_benefit')!
    expect(personal.runs).toBe(0)
    expect(personal.negativeReactionPct).toBe(100)
  })

  test('reports no evidence as null rather than as zero', () => {
    // "Nobody has tried this" and "this never works" are opposite facts, and
    // the same null-is-not-zero rule like_pct already follows.
    const reports = buildEffectiveness([])
    expect(reports).toEqual([])

    const [only] = buildEffectiveness([input('agreed', 'numbers', 'forgot', 'adi', ['numbers'])])
    expect(only!.winPct).toBe(100)
    expect(only!.byReason.find((s) => s.key === 'no_value')).toBeUndefined()
  })
})

describe('whether the technique comparison crosses a model change', () => {
  // experiment-results.ts's readiness() already refuses to call an A/B
  // comparison clean when its arms ran on different models -- two arms on
  // different models are two experiments, not one. A technique's win rate is
  // exactly as vulnerable: it is a property of the persuader model that wrote
  // the winning message as much as of the category it reached for, so pooling
  // runs from two persuader models into one win rate has the same failure
  // shape and deserves the same guard.
  const withModels = (models: Record<string, string> | null): EffectivenessInput => ({
    run: {
      outcome: 'agreed',
      turns: turns(2),
      score: { winningCategory: 'personal_benefit' } as RunScore,
      world: world('forgot'),
      personaId: 'adi',
      fatigue: 0,
      models,
    },
    offered: ['personal_benefit'],
  })

  test('one model fingerprint across every run is not a warning', () => {
    const count = distinctModelFingerprints([
      withModels({ persuader: 'gpt-5' }),
      withModels({ persuader: 'gpt-5' }),
    ])
    expect(count).toBe(1)
  })

  test('a persuader model swap between runs shows up as more than one fingerprint', () => {
    const count = distinctModelFingerprints([
      withModels({ persuader: 'gpt-4o-mini' }),
      withModels({ persuader: 'gpt-4o-mini' }),
      withModels({ persuader: 'gpt-5' }),
    ])
    expect(count).toBe(2)
  })
})

describe('the rendered report', () => {
  test('reads like the shape that was asked for, and flags a thin sample', () => {
    const [report] = buildEffectiveness([
      input('agreed', 'social_proof', 'forgot', 'adi', ['social_proof']),
    ])
    const text = formatTechnique(report!)

    expect(text).toContain('Rule: social_proof')
    expect(text).toContain('By persona:')
    expect(text).toContain('By reason:')
    expect(text).toContain('Avg messages to success:')
    expect(text).toContain('Negative reaction rate:')
    // One run is not a rate, and the report says so rather than printing 100%
    // as though it meant something.
    expect(text).toContain('too few to read')
  })

  test('flags a thin slice even when the overall sample clears the bar', () => {
    // The top-line warning only looks at report.runs, so an overall count of
    // ten stays quiet -- but a single persona buried inside "By persona" can
    // still print a 100% built from one run, sitting unflagged right next to
    // rows built from real samples. A reader scanning the list has no way to
    // tell the two apart without the same warning applied per row.
    const plenty = Array.from({ length: 9 }, (_, i) =>
      input(
        i % 3 === 0 ? 'refused' : 'agreed',
        i % 3 === 0 ? null : 'social_proof',
        'forgot',
        'plenty',
        ['social_proof'],
      ),
    )
    const rare = input('agreed', 'social_proof', 'forgot', 'rare', ['social_proof'])
    const [report] = buildEffectiveness([...plenty, rare])
    const text = formatTechnique(report!, 5)

    expect(report!.runs).toBeGreaterThanOrEqual(5)
    const rareLine = text.split('\n').find((l) => l.includes('rare'))!
    expect(rareLine).toContain('100%')
    expect(rareLine).toMatch(/!/)

    const plentyLine = text.split('\n').find((l) => l.includes('plenty'))!
    expect(plentyLine).not.toMatch(/!/)
  })
})

describe('a win the plan never offered', () => {
  test('is credited to the category that earned it, not dropped', () => {
    // The scorer picks from the whole category list, not from this plan's
    // arguments, so an off-plan winner is a real outcome. Matching only within
    // `offered` dropped the win entirely while still counting the run in every
    // offered technique's denominator: a conversation that succeeded read as a
    // loss for everything and a win for nothing.
    const reports = buildEffectiveness([
      input('agreed', 'authority', 'forgot', 'adi', ['personal_benefit', 'numbers']),
    ])

    const authority = reports.find((r) => r.category === 'authority')
    expect(authority?.wins).toBe(1)
    expect(reports.find((r) => r.category === 'personal_benefit')?.wins).toBe(0)
  })

  test('does not manufacture a perfect win rate out of runs it was never offered on', () => {
    // A loss never adds an unoffered category to `attempted` -- there is no
    // `won` to add -- so a category the plan has never once put on the table
    // can only ever appear here on the runs it happens to win. If those wins
    // also counted toward `runs`, wins === runs would be a certainty of the
    // bookkeeping, not a finding: three off-plan wins would read as a flawless
    // "100% (3 runs)", and the more it happens the more convincing that fake
    // rate gets, eventually clearing the thin-sample warning entirely and
    // feeding `propose()`'s weight ratio as if it were earned.
    const reports = buildEffectiveness([
      input('agreed', 'authority', 'forgot', 'p1', ['personal_benefit', 'numbers']),
      input('agreed', 'authority', 'no_time', 'p2', ['personal_benefit', 'numbers']),
      input('agreed', 'authority', 'no_value', 'p3', ['personal_benefit', 'numbers']),
    ])

    const authority = reports.find((r) => r.category === 'authority')!
    // The wins are still visible, not dropped.
    expect(authority.wins).toBe(3)
    // But not one of them was a deliberately offered run, so there is no rate.
    expect(authority.runs).toBe(0)
    expect(authority.winPct).toBeNull()
  })
})
