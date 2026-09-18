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
