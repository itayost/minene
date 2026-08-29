import { describe, expect, it } from 'vitest'
import { clampPageIndex, parentHref, resolveScreen } from '../src/core/navigation'
import { demoBrand } from './fixtures/demo-brand'

describe('resolveScreen', () => {
  it('resolves the brand root to the home screen', () => {
    expect(resolveScreen(demoBrand, [], null)).toEqual({ kind: 'home' })
  })

  it('resolves a known subject to its chooser', () => {
    expect(resolveScreen(demoBrand, ['multiple'], null)).toEqual({
      kind: 'menu',
      subjectId: 'multiple',
    })
  })

  it('resolves a known group to the viewer at the first page', () => {
    expect(resolveScreen(demoBrand, ['multiple', 'group-one'], null)).toEqual({
      kind: 'viewer',
      subjectId: 'multiple',
      groupId: 'group-one',
      pageIndex: 0,
    })
  })

  it('resolves a known tool', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(resolveScreen(demoBrand, ['tools', toolId], null)).toEqual({
      kind: 'tool',
      toolId,
      subPath: [],
    })
  })

  it('rejects an unknown subject', () => {
    expect(resolveScreen(demoBrand, ['nope'], null)).toBeNull()
  })

  it('rejects an unknown group', () => {
    expect(resolveScreen(demoBrand, ['multiple', 'nope'], null)).toBeNull()
  })

  it('rejects an unknown tool', () => {
    expect(resolveScreen(demoBrand, ['tools', 'nope'], null)).toBeNull()
  })

  it('rejects the bare tools segment', () => {
    expect(resolveScreen(demoBrand, ['tools'], null)).toBeNull()
  })

  it('rejects a path deeper than a group', () => {
    expect(resolveScreen(demoBrand, ['multiple', 'group-one', 'extra'], null)).toBeNull()
  })
})

describe('clampPageIndex', () => {
  it('defaults to the first page when absent', () => {
    expect(clampPageIndex(null, 3)).toBe(0)
  })

  it('converts a one-based parameter to a zero-based index', () => {
    expect(clampPageIndex('2', 3)).toBe(1)
  })

  it('clamps a parameter beyond the last page', () => {
    expect(clampPageIndex('99', 3)).toBe(2)
  })

  it('clamps a parameter below the first page', () => {
    expect(clampPageIndex('0', 3)).toBe(0)
    expect(clampPageIndex('-5', 3)).toBe(0)
  })

  it('falls back to the first page for a non-numeric parameter', () => {
    expect(clampPageIndex('abc', 3)).toBe(0)
    expect(clampPageIndex('1.5', 3)).toBe(0)
    expect(clampPageIndex('', 3)).toBe(0)
  })
})

describe('parentHref', () => {
  it('returns the brand root from the chooser', () => {
    expect(parentHref(demoBrand, { kind: 'menu', subjectId: 'multiple' })).toBe('/demo')
  })

  it('returns the chooser from a viewer whose subject has several groups', () => {
    const screen = {
      kind: 'viewer',
      subjectId: 'multiple',
      groupId: 'group-one',
      pageIndex: 0,
    } as const
    expect(parentHref(demoBrand, screen)).toBe('/demo/multiple')
  })

  it('returns the brand root from a viewer whose subject has one group', () => {
    const screen = {
      kind: 'viewer',
      subjectId: 'single',
      groupId: 'only-group',
      pageIndex: 0,
    } as const
    expect(parentHref(demoBrand, screen)).toBe('/demo')
  })

  it('returns the brand root from a tool', () => {
    expect(
      parentHref(demoBrand, { kind: 'tool', toolId: demoBrand.tools[0]!.id, subPath: [] }),
    ).toBe('/demo')
  })
})

describe('tool subtrees', () => {
  it('resolves a tool sub-screen to that tool, carrying the rest of the path', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(resolveScreen(demoBrand, ['tools', toolId, 'lobby'], null)).toEqual({
      kind: 'tool',
      toolId,
      subPath: ['lobby'],
    })
  })

  it('carries a deeper sub-path too', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(resolveScreen(demoBrand, ['tools', toolId, 'rules', '123'], null)).toEqual({
      kind: 'tool',
      toolId,
      subPath: ['rules', '123'],
    })
  })

  it('resolves the tool root with an empty sub-path', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(resolveScreen(demoBrand, ['tools', toolId], null)).toEqual({
      kind: 'tool',
      toolId,
      subPath: [],
    })
  })

  it('still rejects an unknown tool however deep the path', () => {
    expect(resolveScreen(demoBrand, ['tools', 'nope', 'lobby'], null)).toBeNull()
  })

  it('returns the tool root as the parent of a sub-screen', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(parentHref(demoBrand, { kind: 'tool', toolId, subPath: ['lobby'] })).toBe(
      `/demo/tools/${toolId}`,
    )
  })

  it('returns the brand root as the parent of the tool root', () => {
    const toolId = demoBrand.tools[0]!.id
    expect(parentHref(demoBrand, { kind: 'tool', toolId, subPath: [] })).toBe('/demo')
  })
})
