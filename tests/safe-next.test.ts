import { describe, expect, it } from 'vitest'
import { nextWithinBrand, safeNextPath } from '../src/auth/safe-next'

describe('safeNextPath', () => {
  it('accepts an ordinary absolute path', () => {
    expect(safeNextPath('/minene/results/overview')).toBe('/minene/results/overview')
  })

  it('keeps a query string', () => {
    expect(safeNextPath('/minene/results/overview?page=3')).toBe('/minene/results/overview?page=3')
  })

  it('rejects a protocol-relative path', () => {
    expect(safeNextPath('//evil.example')).toBeNull()
  })

  it('rejects a backslash-prefixed path', () => {
    expect(safeNextPath('/\\evil.example')).toBeNull()
  })

  it('rejects an absolute URL', () => {
    expect(safeNextPath('http://evil.example/minene')).toBeNull()
    expect(safeNextPath('https://evil.example/minene')).toBeNull()
  })

  it('rejects a relative path', () => {
    expect(safeNextPath('minene/results')).toBeNull()
  })

  it('rejects null and empty', () => {
    expect(safeNextPath(null)).toBeNull()
    expect(safeNextPath('')).toBeNull()
  })
})

describe('nextWithinBrand', () => {
  it("accepts a path inside the caller's own brand", () => {
    expect(nextWithinBrand('/minene/results', 'minene')).toBe('/minene/results')
  })

  it('accepts the brand root itself', () => {
    expect(nextWithinBrand('/minene', 'minene')).toBe('/minene')
  })

  it('rejects a path in another brand', () => {
    expect(nextWithinBrand('/other/results', 'minene')).toBeNull()
  })

  it('rejects a brand that merely shares a prefix', () => {
    expect(nextWithinBrand('/minene-other/results', 'minene')).toBeNull()
  })

  it('rejects anything safeNextPath already rejects', () => {
    expect(nextWithinBrand('//evil.example', 'minene')).toBeNull()
  })
})
