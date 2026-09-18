import { describe, expect, test } from 'vitest'
import { normalizeEscalation, planSchema } from '../../src/persuade/engine/plan-schema'

describe('normalizeEscalation', () => {
  test('clamps and rounds rungs into 1-5 and keeps the messages', () => {
    expect(
      normalizeEscalation([
        { rung: 0, message: 'a' },
        { rung: 2.6, message: 'b' },
        { rung: 9, message: 'c' },
      ]),
    ).toEqual([
      { rung: 1, message: 'a' },
      { rung: 3, message: 'b' },
      { rung: 5, message: 'c' },
    ])
  })
})

describe('planSchema', () => {
  test('refuses a ladder that is not five rungs', () => {
    const result = planSchema.shape.escalation.safeParse([
      { rung: 1, message: 'a' },
      { rung: 2, message: 'b' },
    ])
    expect(result.success).toBe(false)
  })
})
