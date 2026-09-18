/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
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
    let state: ConversationState = { ...initialState(), interaction: 1, rung: 1 }
    const turns: Turn[] = []

    const first = applySilence(turns, state)
    expect(first.turn).toEqual({ role: 'target', text: '', silent: true, interaction: 1 })
    expect(first.state.rung).toBe(2)
    expect(first.stopped.stop).toBe(false)

    state = { ...first.state, interaction: 2 } as ConversationState
    const second = applySilence([first.turn], state)
    expect(second.state.rung).toBe(3)
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
