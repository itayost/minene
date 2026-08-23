import { describe, expect, it } from 'vitest'
import { brandHref, groupHref, subjectHref, toolHref } from '../src/core/hrefs'

describe('hrefs', () => {
  it('builds a brand href', () => {
    expect(brandHref('minene')).toBe('/minene')
  })

  it('builds a subject href', () => {
    expect(subjectHref('minene', 'results')).toBe('/minene/results')
  })

  it('builds a group href without a page parameter for the first page', () => {
    expect(groupHref('minene', 'results', 'overview')).toBe('/minene/results/overview')
    expect(groupHref('minene', 'results', 'overview', 0)).toBe('/minene/results/overview')
  })

  it('builds a one-based page parameter for later pages', () => {
    expect(groupHref('minene', 'results', 'overview', 2)).toBe('/minene/results/overview?page=3')
  })

  it('builds a tool href', () => {
    expect(toolHref('minene', 'persuade')).toBe('/minene/tools/persuade')
  })
})
