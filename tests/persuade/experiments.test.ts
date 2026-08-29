/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { compareArms, type ExperimentRun, readiness } from '../../src/persuade/experiment-results'
import {
  type ExperimentSpec,
  messageLengthExperiment,
  planExperiment,
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

const run = (
  variant: string | null,
  outcome: string,
  grade: number | null,
  persuaderTurns: number,
): ExperimentRun => ({
  variant,
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
    expect(readiness(compareArms(runs))).toEqual([])
  })
})
