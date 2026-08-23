import { describe, expect, it } from 'vitest'
import { assertDefined } from '../src/core/invariant'

describe('assertDefined', () => {
  it('returns a defined value unchanged', () => {
    expect(assertDefined('value', 'unreachable')).toBe('value')
  })

  it('throws the given message when the value is undefined', () => {
    expect(() => assertDefined(undefined, 'guarantee violated')).toThrow('guarantee violated')
  })
})
