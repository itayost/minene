/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { SILENT_TURN_MARKER } from '../../src/persuade/engine/prompts'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import type { Run, RunScore, Turn } from '../../src/persuade/engine/types'
import { buildDataset, type SourceRun, sourceRunsFromRows } from '../../src/persuade/lib/dataset'
import { TEST_PLAN } from './helpers'

const output = (over: Record<string, unknown> = {}) => ({
  blocker: 'overloaded',
  evidence: 'אמרה שאין לה זמן',
  tools: ['אמפתיה'],
  message: 'ארבע דקות בבוקר. מתחילים מחר?',
  asksForDecision: true,
  counterpartCommitted: false,
  counterpartRefused: false,
  setsStartTime: true,
  announcesFollowUp: true,
  statesAsk: true,
  statesIdentity: true,
  argumentsUsed: 1,
  signals: { motivatedBy: [], energy: 'medium', autonomyNeed: 'low', respondsToNumbers: null },
  ...over,
})

const persuader = (over: Partial<Turn> = {}): Turn => ({
  role: 'persuader',
  text: 'ארבע דקות בבוקר. מתחילים מחר?',
  interaction: 1,
  rung: 1,
  blocker: 'overloaded',
  output: output(),
  ...over,
})

const target = (text: string): Turn => ({ role: 'target', text, interaction: 1 })

const run = (turns: Turn[], outcome = 'agreed'): Run => ({
  id: 'r1',
  createdAt: '2026-08-29T10:00:00Z',
  planId: 'briefings',
  personaId: 'adi',
  plan: TEST_PLAN,
  persona: null,
  turns,
  state: {
    interaction: 2,
    rung: 2,
    blockers: [],
    signals: {
      motivatedBy: [],
      energy: 'unknown',
      autonomyNeed: 'unknown',
      respondsToNumbers: null,
    },
    fatigue: 0,
    outcome: outcome as Run['state']['outcome'],
    askStated: true,
    identityStated: true,
    startTimeSet: true,
    followUpAnnounced: true,
    silences: 0,
  },
  violations: [],
})

// responseValidity is optional on RunScore (F5): this fixture used to carry
// it purely to satisfy the type, and no test here asserts on its value.
const score = (grade: number): RunScore => ({ grade }) as RunScore

const source = (over: Partial<SourceRun> = {}): SourceRun => ({
  run: run([persuader(), target('סגור')]),
  score: score(90),
  rules: DEFAULT_RULES,
  persona: { name: 'עדי', role: 'מנהלת חנות' },
  ...over,
})

describe('what gets into the training set', () => {
  test('a clean turn from an agreed, well-graded run', () => {
    const { examples } = buildDataset([source()])

    expect(examples).toHaveLength(1)
    const [system, user, assistant] = examples[0]!.messages
    expect(system?.role).toBe('system')
    // The real prompt, rebuilt -- not a summary of it. A model trained on a
    // shorter prompt than production sends is trained on a different task.
    expect(system?.content).toContain('חוקי ליבה')
    expect(user?.content).toBe('התחל את השיחה.')
    // The full structured answer, because that is what production asks for.
    expect(JSON.parse(assistant!.content).statesAsk).toBe(true)
    expect(JSON.parse(assistant!.content).signals).toBeDefined()
  })

  test('a run that did not end in a yes is dropped whole', () => {
    const { examples, rejected } = buildDataset([
      source({ run: run([persuader(), target('לא')], 'refused') }),
    ])

    expect(examples).toHaveLength(0)
    expect(rejected['run-not-agreed']).toBe(1)
  })

  test('a low-graded run is dropped whole', () => {
    const { examples, rejected } = buildDataset([source({ score: score(40) })])
    expect(examples).toHaveLength(0)
    expect(rejected['run-below-grade']).toBe(1)
  })

  test('an old-scale (fractional) grade is dropped for its scale, not folded into run-below-grade', () => {
    // engine/score.ts's own schema comment on `grade` explains the fixture: the
    // judge used to pick a scale per run before `grade` was pinned to a whole
    // number on 0-100, so a three-message agreement once came back as 8.4 while
    // a deferred one came back as 72 -- both defensible on their own scale, and
    // nothing rewrites a row scored before that fix. 8.4 on the OLD scale was a
    // near-perfect run; compared against the 0-100 `minGrade` default of 70 it
    // reads as a failing 8.4/100 and is dropped under 'run-below-grade', the
    // same label a genuinely bad 0-100 run gets. That miscounts a good run as
    // bad and hides the real reason (a scale mismatch) behind a label that
    // claims to know the run was low quality.
    const { examples, rejected } = buildDataset([source({ score: score(8.4) })])
    expect(examples).toHaveLength(0)
    expect(rejected['run-below-grade']).toBeUndefined()
    expect(rejected['run-old-grade-scale']).toBe(1)
  })

  test('an unscored run is dropped rather than assumed good', () => {
    const { examples, rejected } = buildDataset([source({ score: null })])
    expect(examples).toHaveLength(0)
    expect(rejected['run-unscored']).toBe(1)
  })

  test('a turn that broke a rule is dropped, and the rest of the run kept', () => {
    // The deterministic half of the filter, and the reason this engine can
    // select training data better than a judge alone: checkTurn decided this
    // in code, not a model's opinion of it.
    const dirty = persuader({
      violations: [{ rule: 'הודעה ארוכה מ-25 מילים', detail: '40 מילים', severity: 'high' }],
    })
    const { examples, rejected } = buildDataset([
      source({ run: run([dirty, target('אולי'), persuader({ interaction: 2 })]) }),
    ])

    expect(rejected['turn-broke-a-rule']).toBe(1)
    expect(examples).toHaveLength(1)
  })

  test('a turn stored before the full output existed is dropped, not half-used', () => {
    // Training a structured task on a text-only example teaches the model to
    // answer with a string where production expects fourteen fields.
    const legacy = persuader({ output: undefined })
    const { examples, rejected } = buildDataset([source({ run: run([legacy, target('סגור')]) })])

    expect(examples).toHaveLength(0)
    expect(rejected['turn-missing-structured-output']).toBe(1)
  })
})

describe('the prompt each example replays', () => {
  test('is the state as it stood before that turn, not the final state', () => {
    // The opener states the ask, so the turn AFTER it should be told so.
    const first = persuader({ interaction: 0, rung: 1, output: output({ statesAsk: true }) })
    const second = persuader({ interaction: 1, rung: 2 })
    const { examples } = buildDataset([source({ run: run([first, target('אין לי זמן'), second]) })])

    expect(examples).toHaveLength(2)
    // The opener is told the ask has not been stated -- nothing preceded it.
    // The next turn is told it has. Replaying the FINAL state into both would
    // tell the opener the ask was already made, training it to skip the ask it
    // exists to deliver.
    expect(examples[0]!.messages[0]!.content).toContain('הבקשה כבר נאמרה: לא')
    expect(examples[1]!.messages[0]!.content).toContain('הבקשה כבר נאמרה: כן')
  })

  test('carries the history the model actually had', () => {
    const { examples } = buildDataset([
      source({ run: run([persuader(), target('אין לי זמן'), persuader({ interaction: 2 })]) }),
    ])

    const second = examples[1]!.messages
    expect(second.some((m) => m.role === 'user' && m.content === 'אין לי זמן')).toBe(true)
  })

  test('an example that follows a silence carries the F2 reminder guidance; the one before it does not', () => {
    // The engine (turn.ts's turnRequest) decides this from whether the turn
    // right before the current one was silent. Replaying without it would
    // export a system prompt that never mentions the silence next to an
    // answer the persuader model actually wrote under that guidance -- this
    // file's own opening comment's failure mode: a prompt that does not
    // match the answer teaches the model to answer a question it was never
    // asked. This only bites `slow` runs that end `agreed`, which is exactly
    // the data the default filter keeps.
    const silentReply: Turn = { role: 'target', text: '', silent: true, interaction: 0 }
    const first = persuader({ interaction: 0, rung: 1 })
    const second = persuader({ interaction: 1, rung: 2 })
    const { examples } = buildDataset([
      source({ run: run([first, silentReply, second, target('סגור')]) }),
    ])

    expect(examples).toHaveLength(2)
    // Asserted on the guidance text itself (the SILENT_TURN_MARKER and the
    // "short reminder" instruction), not on `no_reply` -- that blocker id is
    // in every prompt's blocker table regardless, so it would not distinguish
    // the two examples.
    expect(examples[0]!.messages[0]!.content).not.toContain(SILENT_TURN_MARKER)
    expect(examples[0]!.messages[0]!.content).not.toContain('שלח תזכורת קצרה')
    expect(examples[1]!.messages[0]!.content).toContain(SILENT_TURN_MARKER)
    expect(examples[1]!.messages[0]!.content).toContain('שלח תזכורת קצרה')
  })
})

describe('resolving the recipient the persuader actually saw', () => {
  const row = (personaId: string | null) => ({
    id: 'r1',
    created_at: '2026-08-29T10:00:00Z',
    plan: TEST_PLAN,
    persona_id: personaId,
    turns: [persuader(), target('סגור')],
    state: run([]).state,
    score: score(90),
    rules: DEFAULT_RULES,
  })

  test('carries the persona through to the replayed prompt', () => {
    // runSimulation always hands the persuader the real recipient, turn by
    // turn -- never null -- so the replayed prompt has to say so too, or it
    // is training on a system message that contradicts the answer beside it.
    const personas = new Map([['adi', { name: 'עדי', role: 'מנהלת חנות' }]])
    const { examples } = buildDataset(sourceRunsFromRows([row('adi')], personas))

    expect(examples[0]!.messages[0]!.content).toContain('עדי, מנהלת חנות')
    expect(examples[0]!.messages[0]!.content).not.toContain('לא נמסר לך מי מולך')
  })

  test('falls back to no recipient only when the row itself carries none', () => {
    const { examples } = buildDataset(sourceRunsFromRows([row(null)], new Map()))
    expect(examples[0]!.messages[0]!.content).toContain('לא נמסר לך מי מולך')
  })

  test('rejects a run whose persona cannot be resolved, rather than exporting it as recipient-less', () => {
    // This row DID carry a persona_id -- runSimulation handed the persuader a
    // real recipient turn by turn -- but the persona lookup found nothing for
    // it (the persona row is gone). That is not the same fact as a row that
    // never had a persona_id at all, and treating it as one recreates the exact
    // contradiction the previous fix removed: a system prompt claiming no
    // recipient was stated, paired with an answer produced under a real one.
    const { examples, rejected } = buildDataset(
      sourceRunsFromRows([row('ghost-persona')], new Map()),
    )

    expect(examples).toHaveLength(0)
    expect(rejected['persona-unresolvable']).toBe(1)
  })
})

describe('deduplication', () => {
  test('two identical openers become one example', () => {
    // Every run of one plan opens from the same state, so this is the common
    // case rather than an edge one -- and a duplicate weights that example
    // double while teaching nothing new.
    const { examples, rejected } = buildDataset([source(), source()])

    expect(examples).toHaveLength(1)
    expect(rejected.duplicate).toBe(1)
  })
})
