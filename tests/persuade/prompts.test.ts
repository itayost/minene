import { describe, expect, test } from 'vitest'
import { persuaderSystemPrompt } from '../../src/persuade/engine/prompts'
import { initialState } from '../../src/persuade/engine/rules'
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
