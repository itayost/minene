import { describe, expect, test } from 'vitest'
import { persuaderSystemPrompt, SILENT_TURN_MARKER } from '../../src/persuade/engine/prompts'
import { DEFAULT_RULES, initialState } from '../../src/persuade/engine/rules'
import { TEST_PLAN } from './helpers'

describe('the persuader prompt', () => {
  test('carries the interaction budget and the ladder', () => {
    const p = persuaderSystemPrompt(TEST_PLAN, initialState(), false)
    expect(p).toContain('מדרגת הסלמה')
    expect(p).toContain('אל תנסה לשכנע לפני שהבנת')
    expect(p).toContain('מתוך 4')
  })

  test('states on whose authority we are calling', () => {
    expect(persuaderSystemPrompt(TEST_PLAN, initialState(), false)).toContain('אושר')
  })

  test('the opener is instructed to greet, not to pitch', () => {
    const p = persuaderSystemPrompt(TEST_PLAN, initialState(), false)
    expect(p).toContain('ההודעה הזאת לא נספרת כאינטראקציית שכנוע')
  })

  test('once it has spoken but not asked, it is told to state the ask', () => {
    const p = persuaderSystemPrompt(TEST_PLAN, initialState(), true)
    expect(p).toContain('עכשיו אומרים את הבקשה')
  })
})

describe('who the persuader is writing to', () => {
  test('with no recipient it is told not to invent one', () => {
    const p = persuaderSystemPrompt(TEST_PLAN, initialState(), false)
    expect(p).toContain('לא נמסר לך מי מולך')
  })

  test('with a recipient it gets the name and the role', () => {
    const p = persuaderSystemPrompt(TEST_PLAN, initialState(), false, undefined, {
      name: 'יוסי',
      role: 'עובד מכירות ותיק',
    })
    expect(p).toContain('יוסי, עובד מכירות ותיק')
    expect(p).toContain('התאם את הניסוח לתפקיד ולמגדר')
  })
})

describe('F2: when the last turn went unanswered', () => {
  test('tells the persuader to send a reminder, names the marker, the rung and the blocker', () => {
    const state = { ...initialState(), rung: 2 as const }
    const p = persuaderSystemPrompt(TEST_PLAN, state, true, DEFAULT_RULES, null, true)

    expect(p).toContain(SILENT_TURN_MARKER)
    expect(p).toContain('no_reply')
    // A reminder, not a restatement of the whole ask.
    expect(p).toContain('תזכורת')
    // Names the rung this message is on.
    expect(p).toContain('2')
  })

  test('is byte-identical to a prompt with no silence flag at all', () => {
    // Guards against the silence block leaking into every prompt: a run with
    // no silence must render exactly as it did before F2.
    const withFlagFalse = persuaderSystemPrompt(
      TEST_PLAN,
      initialState(),
      true,
      DEFAULT_RULES,
      null,
      false,
    )
    const withNoFlag = persuaderSystemPrompt(TEST_PLAN, initialState(), true, DEFAULT_RULES, null)

    expect(withFlagFalse).toBe(withNoFlag)
    // no_reply is always in the blocker table (every blocker is), so the
    // guard is the marker and the exact-equality check above, not its absence.
    expect(withFlagFalse).not.toContain(SILENT_TURN_MARKER)
  })
})
