/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test } from 'vitest'
import { initialState } from '../../src/persuade/engine/rules'
import { streamPersuaderTurn, type TurnEvent } from '../../src/persuade/engine/turn'
import type { Turn } from '../../src/persuade/engine/types'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { PERSUADER_PAYLOAD, streamingJsonModel, TEST_PLAN } from './helpers'

/**
 * "צריך תשובות משני הצדדים קצרות ומידיות - כמו במציאות."
 *
 * A whole JSON object cannot arrive until its last field is written, so the
 * screen had nothing to show for the entire generation however fast the model
 * was. This is the half of the fix that is about the wait rather than the work:
 * the message goes out as it is written, and the grading still happens on the
 * finished object.
 */

afterEach(() => setModelOverrides({}))

const collect = async (turns: Turn[] = []): Promise<TurnEvent[]> => {
  const events: TurnEvent[] = []
  for await (const event of streamPersuaderTurn(TEST_PLAN, turns, initialState())) {
    events.push(event)
  }
  return events
}

describe('streaming one persuader move', () => {
  test('emits the message before the object is finished', async () => {
    setModelOverrides({ persuader: streamingJsonModel(PERSUADER_PAYLOAD) })

    const events = await collect()
    const deltas = events.filter((e) => e.type === 'delta')

    // More than one, or nothing has been streamed -- a single delta carrying the
    // whole message is what a non-streaming implementation looks like from here,
    // and it would pass a weaker assertion.
    expect(deltas.length).toBeGreaterThan(1)
  })

  test('the deltas reassemble into exactly the message that was said', async () => {
    setModelOverrides({ persuader: streamingJsonModel(PERSUADER_PAYLOAD) })

    const events = await collect()
    const streamed = events
      .filter((e) => e.type === 'delta')
      .map((e) => (e.type === 'delta' ? e.text : ''))
      .join('')
    const final = events.find((e) => e.type === 'done')

    // The screen shows the concatenation and the store keeps the turn. If those
    // two ever differ, the conversation someone had is not the conversation that
    // was recorded -- and chunk boundaries falling inside Hebrew words are
    // exactly where that would start.
    expect(final?.type === 'done' && final.result.turn.text).toBe(PERSUADER_PAYLOAD.message)
    expect(streamed).toBe(PERSUADER_PAYLOAD.message)
  })

  test('still grades the finished message, not the half of it that streamed', async () => {
    // A speech, arriving in pieces. Each piece is under the word limit; the
    // message is not. Checking as it streams would clear it.
    const speech = {
      ...PERSUADER_PAYLOAD,
      message: Array.from({ length: 40 }, () => 'מילה').join(' '),
    }
    setModelOverrides({ persuader: streamingJsonModel(speech) })

    const events = await collect()
    const final = events.find((e) => e.type === 'done')

    expect(
      final?.type === 'done' && final.result.turn.violations?.map((v) => v.rule),
    ).toContainEqual(expect.stringContaining('הודעה ארוכה'))
  })

  test('carries the bookkeeping the conversation is driven by', async () => {
    setModelOverrides({ persuader: streamingJsonModel(PERSUADER_PAYLOAD) })

    const events = await collect([{ role: 'persuader', text: 'אהלן', interaction: 0 }])
    const final = events.find((e) => e.type === 'done')

    // The reason the stream is drained and the validated object is still
    // awaited: everything downstream -- the rung, the blocker, whether the ask
    // has been stated -- lives in fields that arrive after the message.
    expect(final?.type === 'done' && final.result.state.askStated).toBe(true)
    expect(final?.type === 'done' && final.result.turn.blocker).toBe('overloaded')
    expect(final?.type === 'done' && final.result.state.interaction).toBe(1)
  })

  test('ends with the result, so a consumer knows the turn is complete', async () => {
    setModelOverrides({ persuader: streamingJsonModel(PERSUADER_PAYLOAD) })

    const events = await collect()

    expect(events.at(-1)?.type).toBe('done')
    expect(events.filter((e) => e.type === 'done')).toHaveLength(1)
  })
})
