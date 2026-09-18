/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test } from 'vitest'
import {
  historyForModel,
  historyForTarget,
  SILENT_TURN_MARKER,
} from '../../src/persuade/engine/prompts'
import type { Turn } from '../../src/persuade/engine/types'
import {
  buildWorld,
  describeWorld,
  isWorldState,
  responsivenessOf,
  staysSilent,
  type WorldState,
  worldCells,
} from '../../src/persuade/engine/world'

const cell = () => worldCells()[0] as ReturnType<typeof worldCells>[number]

describe('the responsiveness axis', () => {
  test('enumerates every combination, three times the old space', () => {
    const cells = worldCells()
    expect(cells).toHaveLength(972)
    expect(new Set(cells.map((c) => JSON.stringify(c))).size).toBe(972)
    expect(new Set(cells.map((c) => c.responsiveness))).toEqual(
      new Set(['answers', 'slow', 'silent']),
    )
  })

  test('a built world carries it and describes it to the counterpart', () => {
    const world = buildWorld({ ...cell(), responsiveness: 'silent' })
    expect(world.responsiveness).toBe('silent')
    expect(describeWorld(world)).toContain('אל תענה')
  })

  test('a world written before the axis existed is still valid and answers', () => {
    // Every queued job and every stored simulation holds one of these.
    const withoutAxis: Partial<WorldState> = { ...buildWorld(cell()) }
    // Deleted rather than destructured: an unused binding is a lint error here.
    delete withoutAxis.responsiveness
    expect(isWorldState(withoutAxis)).toBe(true)
    expect(responsivenessOf(withoutAxis as WorldState)).toBe('answers')
    expect(responsivenessOf(null)).toBe('answers')
  })

  test('an unknown responsiveness is not a world', () => {
    expect(isWorldState({ ...buildWorld(cell()), responsiveness: 'maybe' })).toBe(false)
  })

  test('staysSilent says who answers when', () => {
    const answers = buildWorld({ ...cell(), responsiveness: 'answers' })
    const slow = buildWorld({ ...cell(), responsiveness: 'slow' })
    const silent = buildWorld({ ...cell(), responsiveness: 'silent' })

    expect([0, 1, 2].map((i) => staysSilent(answers, i))).toEqual([false, false, false])
    // Slow ignores the opening message and answers from the second.
    expect([0, 1, 2].map((i) => staysSilent(slow, i))).toEqual([true, false, false])
    expect([0, 1, 2].map((i) => staysSilent(silent, i))).toEqual([true, true, true])
    expect(staysSilent(null, 0)).toBe(false)
  })
})

const persuaderTurn = (text: string, interaction: number): Turn => ({
  role: 'persuader',
  text,
  interaction,
})
const silentTurn = (interaction: number): Turn => ({
  role: 'target',
  text: '',
  silent: true,
  interaction,
})

describe('a turn nobody answered', () => {
  test('reaches the persuader as an explicit no-reply, never as empty text', () => {
    const history = historyForModel([persuaderTurn('שלום', 0), silentTurn(0)])

    expect(history).toEqual([
      { role: 'assistant', content: 'שלום' },
      { role: 'user', content: SILENT_TURN_MARKER },
    ])
    // An empty user message is rejected by some providers and teaches nothing.
    expect(history.every((m) => m.content.length > 0)).toBe(true)
  })

  test("is dropped from the counterpart's own history", () => {
    // The counterpart did not speak, so there is nothing for it to see itself say.
    expect(historyForTarget([persuaderTurn('שלום', 0), silentTurn(0)])).toEqual([
      { role: 'user', content: 'שלום' },
    ])
  })

  test('two persuader messages straddling a silence merge into one user message', () => {
    // historyForTarget drops the silent turn, which would otherwise leave two
    // consecutive `user` messages -- a shape some providers (Anthropic) reject
    // outright. Both texts must survive in the single merged message.
    const history = historyForTarget([
      persuaderTurn('שלום', 0),
      silentTurn(0),
      persuaderTurn('תזכורת קטנה', 1),
    ])

    expect(history).toEqual([{ role: 'user', content: 'שלום\nתזכורת קטנה' }])
  })
})

import {
  applySilence,
  DEFAULT_RULES,
  detectOutcome,
  fatigueScore,
  initialState,
  silenceCount,
} from '../../src/persuade/engine/rules'
import type { ConversationState } from '../../src/persuade/engine/types'

describe('the ladder answers silence', () => {
  test('silence is not fatigue', () => {
    const tired = [
      { role: 'target' as const, text: 'בסדר', interaction: 1 },
      { role: 'target' as const, text: 'נראה', interaction: 2 },
    ]
    expect(fatigueScore(tired)).toBeGreaterThan(0)
    expect(fatigueScore([silentTurn(1), silentTurn(2)])).toBe(0)
    expect(silenceCount([...tired, silentTurn(3)])).toBe(1)
  })

  test('each unanswered message climbs exactly one rung', () => {
    // interaction: 0 is the state a real run actually occupies at the first
    // silence: the opener does not spend an interaction, so nothing has
    // advanced it yet. Starting this test at interaction: 1 (as it used to)
    // hid the bug F1 fixes -- the ladder climbed in the test only because the
    // test itself had already pre-advanced the counter the code was
    // (wrongly) relying on.
    const state: ConversationState = { ...initialState(), interaction: 0, rung: 1 }
    const turns: Turn[] = []

    const first = applySilence(turns, state)
    expect(first.turn).toEqual({ role: 'target', text: '', silent: true, interaction: 0 })
    expect(first.state.rung).toBe(2)
    expect(first.state.silences).toBe(1)
    expect(first.stopped.stop).toBe(false)

    // interaction stays 0: nothing in this test states the ask, so nothing
    // advances it. The climb below comes from silences alone.
    const second = applySilence([first.turn], first.state)
    expect(second.state.rung).toBe(3)
    expect(second.state.silences).toBe(2)
    expect(second.stopped.stop).toBe(false)
  })

  test('three unanswered messages end the run as no_response, two do not', () => {
    const state = { ...initialState(), interaction: 3, rung: 3 as const }
    const twoSilences = [silentTurn(1), silentTurn(2)]

    const third = applySilence(twoSilences, state)

    expect(third.state.outcome).toBe('no_response')
    expect(third.stopped.stop).toBe(true)
    expect(third.stopped.reason).toContain('לא ענה')

    const second = applySilence([silentTurn(1)], { ...state, interaction: 2 })
    expect(second.state.outcome).toBe('open')
    expect(second.stopped.stop).toBe(false)
  })

  test('the ladder can be switched off, and then silence only counts', () => {
    const rules = { ...DEFAULT_RULES, enforceSilenceLadder: false }
    const state = { ...initialState(), interaction: 1, rung: 1 as const }

    const result = applySilence([], state, rules)

    expect(result.state.rung).toBe(1)
    expect(result.turn.silent).toBe(true)
  })
})

describe('a vague yes is not a yes', () => {
  test('a commitment with a vague time defers', () => {
    expect(detectOutcome('כן כן, מחר')).toBe('deferred')
    expect(detectOutcome('סגור, אשתדל בהמשך')).toBe('deferred')
  })

  test('a commitment with a real start still agrees', () => {
    expect(detectOutcome('סגור, אני עושה את זה מחר בבוקר בתשע')).toBe('agreed')
    expect(detectOutcome('סגור, אני עושה את זה')).toBe('agreed')
  })

  test('a named day is an anchor, not a vague yes', () => {
    // "מחר" names a specific day, so it anchors the commitment, making it real.
    // Only "כן כן" (yes yes) without an anchor is a deferral.
    expect(detectOutcome('סגור, אני עושה את זה מחר')).toBe('agreed')
  })

  test('a refusal is still a refusal and an open reply is still open', () => {
    expect(detectOutcome('לא מסכים, זה לא עובד')).toBe('refused')
    expect(detectOutcome('כמה זמן זה לוקח?')).toBe('open')
  })
})

describe('F3: concrete-time markers stop mislabelling real commitments', () => {
  test('a day named without the ב prefix still anchors the commitment', () => {
    // The old list only matched "ביום ראשון". "אשתדל יום ראשון" names the same
    // day without the prefix and was wrongly read as a vague deferral.
    expect(detectOutcome('סגור, אשתדל יום ראשון')).toBe('agreed')
  })

  test('all seven days count, including the two that were missing', () => {
    expect(detectOutcome('סגור, אשתדל ביום שישי')).toBe('agreed')
  })

  test('a digit time anchors the commitment even next to a vague word', () => {
    expect(detectOutcome('כן כן, מחר ב-9')).toBe('agreed')
  })

  test('היום anchors the commitment the same way a named day does', () => {
    expect(detectOutcome('סגור, אשתדל היום')).toBe('agreed')
  })

  test('בשעה טובה is the idiom, not a time, and anchors nothing', () => {
    // בשעה only counts when a digit or a spelled-out hour follows it. "טובה"
    // is neither, so this is a vague "כן כן" with nothing concrete behind it.
    expect(detectOutcome('כן כן בשעה טובה')).toBe('deferred')
  })

  test('כן כן alone, with nothing to anchor it, still defers', () => {
    expect(detectOutcome('כן כן')).toBe('deferred')
  })

  test('a real commitment with no vague marker still agrees', () => {
    expect(detectOutcome('סגור, אני עושה את זה')).toBe('agreed')
  })
})

describe('R3: a digit followed by a duration unit is not a clock time', () => {
  test('"ב-2 שבועות" (in two weeks) is a vague duration, not a time -- defers', () => {
    expect(detectOutcome('כן כן, אשתדל ב-2 שבועות')).toBe('deferred')
  })

  test('the same duration with the definite article on the unit word also defers', () => {
    expect(detectOutcome('כן כן, אשתדל ב2 השבועות הקרובים')).toBe('deferred')
  })

  test('a space before the digit anchors a commitment exactly like a hyphen does', () => {
    // The old pattern only accepted "ב-9". "ב 9" named the same nine o'clock
    // with a space instead of a hyphen and was missed.
    expect(detectOutcome('כן כן, מחר ב-9')).toBe('agreed')
    expect(detectOutcome('כן כן, מחר ב 9')).toBe('agreed')
  })

  test('every row from the previous wave keeps passing', () => {
    expect(detectOutcome('סגור, אשתדל יום ראשון')).toBe('agreed')
    expect(detectOutcome('סגור, אשתדל ביום שישי')).toBe('agreed')
    expect(detectOutcome('סגור, אשתדל היום')).toBe('agreed')
    expect(detectOutcome('כן כן בשעה טובה')).toBe('deferred')
    expect(detectOutcome('כן כן')).toBe('deferred')
    expect(detectOutcome('סגור, אני עושה את זה')).toBe('agreed')
  })
})

describe('R4: a day/today marker does not match inside a longer, unrelated word', () => {
  test('the required-by-the-brief pair still defers', () => {
    // Both are already deferred under strict Hebrew spelling: "היום" ends in
    // a word-final mem (ם), and neither "היומי" nor "ביומן" can validly carry
    // that letter anywhere but their own final position, so plain substring
    // matching never actually collided on these two specific words. Kept as
    // regression coverage per the brief; see the report for the genuinely
    // reproducing case below.
    expect(detectOutcome('כן כן, היומי')).toBe('deferred')
    expect(detectOutcome('כן כן, ביומן')).toBe('deferred')
  })

  test('היום still anchors a real commitment on its own', () => {
    expect(detectOutcome('סגור, אשתדל היום')).toBe('agreed')
  })

  test('R4 genuine repro: "בערב" (evening) is a real substring prefix of "בערבית" (in Arabic)', () => {
    // Unlike "היום", "בערב" does not end in a word-final letter, so Hebrew's
    // own orthography gives it no protection: "בערבית" is spelled exactly as
    // "בערב" + "ית", with no letter-form change required. This is the actual
    // reproducible instance of the class of bug R4 describes -- containsAny
    // is substring-based, and a marker with no distinguishing final letter
    // matches straight into an unrelated longer word.
    expect(detectOutcome('כן כן, אעשה את זה בערבית')).toBe('deferred')
    // Control: the standalone word must keep working.
    expect(detectOutcome('כן כן, אעשה את זה בערב')).toBe('agreed')
  })

  test('a day name still matches with its usual "ב" prefix and no space', () => {
    // "יום ראשון" is deliberately unprefixed in the marker list so both
    // "יום ראשון" and "ביום ראשון" match -- a boundary check must not
    // require a space before the marker, only forbid another Hebrew letter
    // after it.
    expect(detectOutcome('סגור, אשתדל ביום שישי')).toBe('agreed')
  })
})

import { runSimulation } from '../../src/persuade/engine/simulation'
import { persuaderTurn as runPersuaderTurn } from '../../src/persuade/engine/turn'
import type { Run } from '../../src/persuade/engine/types'
import { setModelOverrides } from '../../src/persuade/lib/model'
import {
  jsonModel,
  PERSUADER_PAYLOAD,
  recordingJsonModel,
  TEST_PERSONA,
  TEST_PLAN,
  textModel,
} from './helpers'

afterEach(() => setModelOverrides({}))

/**
 * statesAsk: false, unlike PERSUADER_PAYLOAD. Production forbids stating the
 * ask in the opening message, and jsonModel repeats this reply for every
 * later call too -- so it stands in for the opener and for every reminder
 * that follows a silence, none of which restate the ask either (F2). The old
 * fixture used PERSUADER_PAYLOAD (statesAsk: true) for the opener, which is
 * not a message the production prompt would ever produce, and it hid F1's bug:
 * the opener wrongly counted as a persuasion interaction, which by luck moved
 * the broken rung formula off of 1 before anyone noticed it never climbed.
 */
const OPENER_PAYLOAD = { ...PERSUADER_PAYLOAD, statesAsk: false }

async function collect(world: WorldState | null): Promise<Run> {
  let run: Run | null = null
  for await (const event of runSimulation({ plan: TEST_PLAN, persona: TEST_PERSONA, world })) {
    if (event.type === 'done') run = event.run
  }
  if (!run) throw new Error('no run')
  return run
}

describe('a run against someone who does not answer', () => {
  test('never calls the counterpart, and ends as no_response', async () => {
    let targetCalls = 0
    const counting = textModel(['לא אמור להיקרא'])
    setModelOverrides({
      // statesAsk: false on every persuader turn, not just the opener: nobody
      // ever hears the ask in a silent world, so every message after the
      // opener is realistically a reminder (F2), never a restatement. This is
      // also what makes the rung sequence below deterministic -- if the ask
      // were marked stated, the interaction counter would climb the ladder a
      // second time on top of the silences, past the spec's three rungs.
      persuader: jsonModel([OPENER_PAYLOAD]),
      target: new Proxy(counting, {
        get(model, key, receiver) {
          if (key === 'doGenerate') targetCalls += 1
          return Reflect.get(model, key, receiver)
        },
      }),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'silent' }))

    expect(targetCalls).toBe(0)
    expect(run.state.outcome).toBe('no_response')
    expect(run.turns.filter((t) => t.silent)).toHaveLength(3)
    expect(run.turns.filter((t) => t.role === 'persuader')).toHaveLength(3)
    // The spec's ladder for silence: reminder, personal approach, manager --
    // rungs 1, 2, 3, exactly, on the three persuader messages. Not a lower
    // bound: F1 was that the ladder never climbed at all in a real silent run
    // (rungs 1, 1, 2), and a >= assertion would pass on that broken behaviour
    // too.
    expect(run.turns.filter((t) => t.role === 'persuader').map((t) => t.rung)).toEqual([1, 2, 3])
  })

  test('R1: a silent run whose opener states the ask still climbs one rung at a time', async () => {
    // Unlike the OPENER_PAYLOAD test above, PERSUADER_PAYLOAD has
    // statesAsk: true on every turn -- the realistic case where an
    // interaction is being spent (askStated becomes true) on the same round
    // a silence also lands. Before the fix, applySilence advances the rung
    // for the reminder, and turnRequest for that same reminder advances it a
    // second time from the already-advanced state, printing rungs [1, 3, 5]
    // instead of the spec's [1, 2, 3].
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['לא אמור להיקרא']),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'silent' }))

    expect(run.state.outcome).toBe('no_response')
    expect(run.turns.filter((t) => t.role === 'persuader').map((t) => t.rung)).toEqual([1, 2, 3])
  })

  test('R1: two turnRequest calls straddling one silence never advance the rung by more than one', async () => {
    // Unit-level companion to the run-level test above: drives persuaderTurn
    // (which builds its call through turnRequest) directly across a single
    // silence, without a full three-round simulation, so the rung delta at
    // exactly that boundary is the only thing under test.
    setModelOverrides({ persuader: jsonModel([PERSUADER_PAYLOAD]) })
    const recipient = { name: TEST_PERSONA.name, role: TEST_PERSONA.role }

    const opener = await runPersuaderTurn(TEST_PLAN, [], initialState(), DEFAULT_RULES, recipient)
    expect(opener.turn.rung).toBe(1)

    const silence = applySilence([opener.turn], opener.state, DEFAULT_RULES)
    const reminder = await runPersuaderTurn(
      TEST_PLAN,
      [opener.turn, silence.turn],
      silence.state,
      DEFAULT_RULES,
      recipient,
    )

    expect(reminder.turn.rung).toBe(2)
    expect((reminder.turn.rung ?? 0) - (opener.turn.rung ?? 0)).toBeLessThanOrEqual(1)
  })

  test('a slow world is ignored once and then answers', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['סגור, אני עושה את זה']),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'slow' }))

    expect(run.turns.filter((t) => t.silent)).toHaveLength(1)
    expect(run.state.outcome).toBe('agreed')
  })

  test('a world that answers behaves exactly as before', async () => {
    setModelOverrides({
      persuader: jsonModel([PERSUADER_PAYLOAD]),
      target: textModel(['סגור, אני עושה את זה']),
    })

    const run = await collect(buildWorld({ ...cell(), responsiveness: 'answers' }))

    expect(run.turns.some((t) => t.silent)).toBe(false)
    expect(run.state.outcome).toBe('agreed')
    expect(run.turns).toHaveLength(2)
  })
})

import { initialState as freshState } from '../../src/persuade/engine/rules'
import { scoreRun } from '../../src/persuade/engine/score'

const JUDGE_PAYLOAD = {
  persuaded: 'no',
  winningArgument: null,
  winningCategory: null,
  mainObjection: null,
  whatBrokeIt: null,
  whatFailed: 'לא הגיעה תשובה',
  grade: 30,
  notes: 'הנמען לא ענה',
  responseValidity: 'none',
}

describe('response validity', () => {
  test('comes back on the score and survives an unknown-free schema', async () => {
    setModelOverrides({ judge: jsonModel([JUDGE_PAYLOAD]) })

    const score = await scoreRun(
      TEST_PLAN,
      [persuaderTurn('שלום', 0), silentTurn(0)],
      { ...freshState(), outcome: 'no_response' },
      [],
    )

    expect(score.responseValidity).toBe('none')
    expect(score.interactionsUsed).toBe(0)
  })

  test('the judge is told the four values and what a valid response means', async () => {
    const { model, prompts } = recordingJsonModel([JUDGE_PAYLOAD])
    setModelOverrides({ judge: model })

    await scoreRun(TEST_PLAN, [persuaderTurn('שלום', 0), silentTurn(0)], freshState(), [])

    const asked = prompts()[0] ?? ''
    expect(asked).toContain('(לא ענה)')
    // F4: the prompt used to say "a valid response is one of the four" and
    // then list `none` among them -- `none` is the absence of one, not a
    // fourth kind of it. Asserted on the guidance itself, not only on the
    // transcript marker the old version of this test stopped at.
    expect(asked).toContain('שלושת הראשונים הם תשובה תקינה')
    expect(asked).toContain('none הוא ההיעדר של תשובה תקינה')
    expect(asked).not.toContain('תשובה תקינה היא אחת מהארבע')
    // Kept from before the reword: a reasoned refusal is a valid response even
    // when the persuasion itself failed.
    expect(asked).toContain('סירוב מנומק הוא תשובה תקינה גם אם השכנוע נכשל')
  })
})
