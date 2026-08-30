/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { worldCells } from '../../src/persuade/engine/world'
import { compareArms, type ExperimentRun, readiness } from '../../src/persuade/experiment-results'
import {
  type ExperimentSpec,
  goldenStride,
  messageLengthExperiment,
  planExperiment,
  planSweep,
  validateExperiment,
} from '../../src/persuade/lib/experiments'

const PAIRS = [
  { personaKey: 'adi', planKey: 'briefings' },
  { personaKey: 'rona', planKey: 'briefings' },
]

const spec = (over: Partial<ExperimentSpec> = {}): ExperimentSpec => ({
  experiment: 'message-length',
  pairs: PAIRS,
  arms: [
    { variant: 'short-25', rules: { ...DEFAULT_RULES, maxWordsPerMessage: 25 } },
    { variant: 'long-45', rules: { ...DEFAULT_RULES, maxWordsPerMessage: 45 } },
  ],
  ...over,
})

describe('planning an experiment', () => {
  test('runs every arm against every pair, so only the config differs', async () => {
    const jobs = planExperiment(spec({ repeats: 2 }))

    // 2 arms x 2 pairs x 2 repeats. The pairing is the whole design: an arm
    // that ran against different personas than its rival measures the personas.
    expect(jobs).toHaveLength(8)
    for (const variant of ['short-25', 'long-45']) {
      const mine = jobs.filter((j) => j.variant === variant)
      expect(mine.map((j) => j.persona_key).sort()).toEqual(['adi', 'adi', 'rona', 'rona'])
    }
  })

  test('carries the config on the job, not just the name of the arm', () => {
    const jobs = planExperiment(spec())

    // The worker runs what the row says. A variant name with no rules beside it
    // is a label that means whatever the code happened to default to that week.
    expect(jobs.find((j) => j.variant === 'short-25')?.rules.maxWordsPerMessage).toBe(25)
    expect(jobs.find((j) => j.variant === 'long-45')?.rules.maxWordsPerMessage).toBe(45)
  })
})

describe('refusing an experiment that could not answer anything', () => {
  test('needs two arms', () => {
    const problems = validateExperiment(spec({ arms: [spec().arms[0]!] }))
    expect(problems.join(' ')).toMatch(/שתי זרועות/)
  })

  test('rejects two arms with identical settings', () => {
    const arm = spec().arms[0]!
    const problems = validateExperiment(spec({ arms: [arm, { ...arm, variant: 'copy' }] }))
    expect(problems.join(' ')).toMatch(/אותן הגדרות/)
  })

  test('rejects arms that differ in more than one setting', () => {
    // Two arms differing in three settings tell you the three together did
    // something and nothing about which. At eleven model calls a run, that is
    // an expensive way to learn nothing.
    const problems = validateExperiment(
      spec({
        arms: [
          { variant: 'a', rules: { ...DEFAULT_RULES, maxWordsPerMessage: 25 } },
          {
            variant: 'b',
            rules: { ...DEFAULT_RULES, maxWordsPerMessage: 45, maxInteractions: 6 },
          },
        ],
      }),
    )
    expect(problems.join(' ')).toMatch(/יותר מהגדרה אחת/)
  })

  test('the ready-made length experiment is itself valid', () => {
    expect(validateExperiment(messageLengthExperiment(PAIRS))).toEqual([])
  })
})

const SAME_MODELS = { persuader: 'gpt-5.5', target: 'gpt-5.4-mini', judge: 'gpt-5.5' }

const run = (
  variant: string | null,
  outcome: string,
  grade: number | null,
  persuaderTurns: number,
  models: Record<string, string> | null = SAME_MODELS,
): ExperimentRun => ({
  variant,
  models,
  outcome: outcome as ExperimentRun['outcome'],
  turns: Array.from({ length: persuaderTurns }, () => ({
    role: 'persuader' as const,
    text: 'x',
    interaction: 1,
  })),
  score: grade === null ? null : ({ grade } as ExperimentRun['score']),
})

describe('reading the result', () => {
  test('reports rate, grade and how long a yes took', () => {
    // compareArms sorts by variant name, so long-45 comes before short-25.
    const [long, short] = compareArms([
      run('short-25', 'agreed', 80, 3),
      run('short-25', 'agreed', 90, 3),
      run('short-25', 'refused', 40, 5),
      run('long-45', 'agreed', 70, 5),
      run('long-45', 'refused', 30, 5),
      run('long-45', 'refused', 20, 5),
    ]) as [ReturnType<typeof compareArms>[number], ReturnType<typeof compareArms>[number]]

    expect(long.variant).toBe('long-45')
    expect(short.agreedPct).toBe(66.7)
    expect(long.agreedPct).toBe(33.3)
    expect(short.meanGrade).toBe(70)
    // The half that matters for a report about conversations being too long:
    // the same yes, reached in fewer messages.
    expect(short.meanTurnsToYes).toBe(3)
    expect(long.meanTurnsToYes).toBe(5)
  })

  test('a run belonging to no arm is not counted into one', () => {
    // Hand-started runs from the lab carry no variant. Folding them into an arm
    // would attribute them to a setting they never tested.
    const arms = compareArms([run(null, 'agreed', 100, 1), run('short-25', 'refused', 10, 4)])

    expect(arms).toHaveLength(1)
    expect(arms[0]?.runs).toBe(1)
  })

  test('an unscored run still counts toward the rate', () => {
    // Scoring is a separate pass. A run that has not been judged yet is still a
    // conversation that ended in a yes or a no, and dropping it would bias the
    // rate toward whatever got scored first.
    const arms = compareArms([run('a', 'agreed', null, 2), run('b', 'refused', null, 4)])
    expect(arms[0]?.agreedPct).toBe(100)
    expect(arms[0]?.meanGrade).toBeNull()
  })
})

describe('whether the comparison is worth reading yet', () => {
  test('says so when an arm is too small', () => {
    const arms = compareArms([run('a', 'agreed', 80, 2), run('b', 'refused', 40, 4)])
    expect(readiness(arms).join(' ')).toMatch(/ריצות בלבד/)
  })

  test('flags arms of very different sizes', () => {
    const runs = [
      ...Array.from({ length: 30 }, () => run('a', 'agreed', 80, 2)),
      ...Array.from({ length: 10 }, () => run('b', 'refused', 40, 4)),
    ]
    expect(readiness(compareArms(runs)).join(' ')).toMatch(/בגדלים שונים/)
  })

  test('stays quiet when both arms are big and even', () => {
    const runs = [
      ...Array.from({ length: 20 }, () => run('a', 'agreed', 80, 2)),
      ...Array.from({ length: 20 }, () => run('b', 'refused', 40, 4)),
    ]
    expect(readiness(compareArms(runs), 10, runs)).toEqual([])
  })

  test('refuses a comparison that spans a model change', () => {
    // The failure that looks most like a result: a clean, large, confident
    // difference between two arms that is entirely a model swap. Every other
    // warning is about confidence; this one is about the comparison not being
    // a comparison at all.
    const runs = [
      ...Array.from({ length: 20 }, () => run('a', 'agreed', 80, 2)),
      ...Array.from({ length: 20 }, () =>
        run('b', 'refused', 40, 4, {
          persuader: 'gpt-5.4-mini',
          target: 'gpt-5.4-mini',
          judge: 'gpt-5.5',
        }),
      ),
    ]

    expect(readiness(compareArms(runs), 10, runs).join(' ')).toMatch(/החלפת המודל/)
  })

  test('says so when nothing recorded which models ran', () => {
    const runs = [
      ...Array.from({ length: 20 }, () => run('a', 'agreed', 80, 2, null)),
      ...Array.from({ length: 20 }, () => run('b', 'refused', 40, 4, null)),
    ]
    expect(readiness(compareArms(runs), 10, runs).join(' ')).toMatch(/לא נרשם אילו מודלים/)
  })

  test('does not claim a confirmed model swap when only some rows predate tracking', () => {
    // `models` became a column partway through this lab's life -- ExperimentRun
    // says so ("Null on rows predating it"). An arm that is half old rows (null)
    // and half new rows on the SAME model is not evidence the arms differ; it is
    // missing data on the old half. The strong claim ("the comparison measures
    // the model swap") must be reserved for two DIFFERENT recorded model sets,
    // not for "recorded" vs "not recorded".
    const runs = [
      ...Array.from({ length: 10 }, () => run('a', 'agreed', 80, 2, null)),
      ...Array.from({ length: 10 }, () => run('a', 'agreed', 80, 2, SAME_MODELS)),
      ...Array.from({ length: 20 }, () => run('b', 'refused', 40, 4, SAME_MODELS)),
    ]
    const warnings = readiness(compareArms(runs), 10, runs).join(' ')
    expect(warnings).not.toMatch(/ההשוואה מודדת את החלפת המודל/)
    expect(warnings).toMatch(/לא נרשם אילו מודלים הריצו את כולן/)
  })
})

describe('sweeping the world space', () => {
  test('gives every job a world, and the experiment arms none', () => {
    // The two halves of the loop. An experiment varies a setting and holds the
    // world still; a sweep holds the settings still and walks the worlds.
    const jobs = planSweep({ personaKeys: ['adi'], planKeys: ['briefings'], cells: 5 })

    expect(jobs).toHaveLength(5)
    expect(jobs.every((j) => j.world !== null)).toBe(true)
    expect(jobs.every((j) => j.experiment === null && j.variant === null)).toBe(true)
  })

  test('spreads a short sweep across the dimensions, not down one of them', () => {
    // worldCells nests pressure inside reason inside workload inside
    // motivation, so a contiguous block of ten is ten variations of one
    // situation. A sweep that narrow would report coverage it does not have.
    const jobs = planSweep({ personaKeys: ['adi'], planKeys: ['p'], cells: 8 })
    const worlds = jobs.map((j) => j.world!)

    expect(new Set(worlds.map((w) => w.reason)).size).toBeGreaterThan(2)
    expect(new Set(worlds.map((w) => w.workload)).size).toBeGreaterThan(1)
    expect(new Set(worlds.map((w) => w.motivation)).size).toBeGreaterThan(1)
  })

  test('derives a stride that stays coprime as axes are added', () => {
    // The load-bearing property. A stride sharing a factor with the space
    // revisits a subset and never reaches the rest, so a sweep would silently
    // stop covering. Checked across sizes because the brief says more axes are
    // coming and the stride has already been wrong once: 37 was tuned for 162
    // cells, and one new axis made it 324.
    for (const n of [162, 324, 648, 1296, 7680, 11520]) {
      const s = goldenStride(n)
      expect(s).toBeGreaterThan(0)
      expect(s).toBeLessThan(n)
      const seen = new Set<number>()
      for (let i = 0; i < n; i += 1) seen.add((i * s) % n)
      expect(seen.size).toBe(n)
    }
  })

  test('visits every cell before repeating any', () => {
    const all = worldCells().length
    const jobs = planSweep({ personaKeys: ['a'], planKeys: ['p'], cells: all })
    expect(new Set(jobs.map((j) => JSON.stringify(j.world))).size).toBe(all)
  })

  test('walks the enumeration rather than sampling it', () => {
    // Random sampling re-runs the easy cells and leaves holes nobody can name.
    // Walking means coverage is a fact you can state.
    const first = planSweep({ personaKeys: ['adi'], planKeys: ['p'], cells: 3 })
    const next = planSweep({ personaKeys: ['adi'], planKeys: ['p'], cells: 3, after: 3 })

    const seen = [...first, ...next].map((j) => JSON.stringify(j.world))
    expect(new Set(seen).size).toBe(6)
  })

  test('wraps around rather than running off the end', () => {
    const all = worldCells().length
    const jobs = planSweep({ personaKeys: ['adi'], planKeys: ['p'], cells: 2, after: all - 1 })
    expect(jobs).toHaveLength(2)
  })

  test('crosses every persona and plan with every cell', () => {
    const jobs = planSweep({
      personaKeys: ['adi', 'rona'],
      planKeys: ['briefings', 'other'],
      cells: 3,
    })
    // 3 cells x 2 personas x 2 plans.
    expect(jobs).toHaveLength(12)
  })

  test('records the reason as the cell, so the matrix has its third axis', () => {
    const jobs = planSweep({ personaKeys: ['adi'], planKeys: ['p'], cells: 1 })
    expect(jobs[0]!.need).toBe(jobs[0]!.world!.reason)
  })
})
