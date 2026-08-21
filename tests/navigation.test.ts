import { describe, expect, test } from 'vitest'
import type { BrandManifest } from '../src/core/brand-types'
import {
  createInitialScreen,
  openGroup,
  openSubject,
  reduceNavigation,
  type Screen,
} from '../src/core/navigation'

const page = (number: number) => ({ src: `/brands/demo/page-${number}.png`, alt: `Page ${number}` })

const singleGroupBrand: BrandManifest = {
  id: 'single-brand',
  name: 'Single Brand',
  title: 'Single Brand',
  locale: 'en-US',
  direction: 'ltr',
  logo: page(0),
  theme: {
    primary: '#000', primaryStrong: '#000', text: '#000', muted: '#000',
    background: '#000', surface: '#000', border: '#000', fontFamily: 'sans-serif',
  },
  labels: { home: 'Home', share: 'Share', save: 'Save', whatsapp: 'WhatsApp' },
  subjects: [{
    id: 'single', label: 'Single', icon: 'book', cardColor: '#fff',
    groups: [{ id: 'only', label: 'Only', pages: [page(1), page(2)] }],
  }],
  tools: [{ id: 'help', label: 'Help', icon: 'help', items: ['Help'] }],
}

const multiGroupBrand: BrandManifest = {
  ...singleGroupBrand,
  id: 'multi-brand',
  subjects: [{
    id: 'multi', label: 'Multi', icon: 'book', cardColor: '#fff',
    groups: [
      { id: 'first', label: 'First', pages: [page(1), page(2), page(3)] },
      { id: 'second', label: 'Second', pages: [page(4)] },
    ],
  }],
}

describe('navigation', () => {
  test('starts on home', () => {
    expect(createInitialScreen()).toEqual({ kind: 'home' })
  })

  test('opens a single-group subject directly in its viewer', () => {
    expect(openSubject(singleGroupBrand, 'single', {})).toMatchObject({
      kind: 'viewer', subjectId: 'single', groupId: 'only', pageIndex: 0,
    })
  })

  test('opens a multi-group subject in its group menu', () => {
    expect(openSubject(multiGroupBrand, 'multi', {})).toEqual({ kind: 'menu', subjectId: 'multi' })
  })

  test('restores and clamps a group progress index', () => {
    expect(openGroup(multiGroupBrand, 'multi', 'first', { 'multi/first': 99 })).toEqual({
      kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 2,
    })
    expect(openGroup(multiGroupBrand, 'multi', 'first', { 'multi/first': -1 })).toEqual({
      kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 0,
    })
  })

  test('back from a multi-group viewer returns to its subject menu', () => {
    const viewer: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 1 }
    expect(reduceNavigation(multiGroupBrand, viewer, { type: 'back' }, {})).toEqual({
      kind: 'menu', subjectId: 'multi',
    })
  })

  test('back from a single-group viewer returns home', () => {
    const viewer: Screen = { kind: 'viewer', subjectId: 'single', groupId: 'only', pageIndex: 1 }
    expect(reduceNavigation(singleGroupBrand, viewer, { type: 'back' }, {})).toEqual({ kind: 'home' })
  })

  test('home action returns home from any screen', () => {
    expect(reduceNavigation(multiGroupBrand, { kind: 'menu', subjectId: 'multi' }, { type: 'home' }, {})).toEqual({ kind: 'home' })
  })

  test('next and previous stop at viewer page boundaries', () => {
    const first: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 0 }
    const last: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 2 }
    expect(reduceNavigation(multiGroupBrand, first, { type: 'page-previous' }, {})).toEqual(first)
    expect(reduceNavigation(multiGroupBrand, first, { type: 'page-next' }, {})).toEqual({ ...first, pageIndex: 1 })
    expect(reduceNavigation(multiGroupBrand, last, { type: 'page-next' }, {})).toEqual(last)
  })

  test('selects an in-range page and ignores an out-of-range page', () => {
    const viewer: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 0 }
    expect(reduceNavigation(multiGroupBrand, viewer, { type: 'page-select', pageIndex: 2 }, {})).toEqual({ ...viewer, pageIndex: 2 })
    expect(reduceNavigation(multiGroupBrand, viewer, { type: 'page-select', pageIndex: 8 }, {})).toEqual(viewer)
  })

  test('opens a tool', () => {
    expect(reduceNavigation(multiGroupBrand, { kind: 'home' }, { type: 'open-tool', toolId: 'help' }, {})).toEqual({ kind: 'tool', toolId: 'help' })
  })

  test('falls back to home for invalid subject, group, tool, or screen IDs', () => {
    expect(openSubject(multiGroupBrand, 'missing', {})).toEqual({ kind: 'home' })
    expect(openGroup(multiGroupBrand, 'multi', 'missing', {})).toEqual({ kind: 'home' })
    expect(reduceNavigation(multiGroupBrand, { kind: 'home' }, { type: 'open-tool', toolId: 'missing' }, {})).toEqual({ kind: 'home' })
    expect(reduceNavigation(multiGroupBrand, { kind: 'menu', subjectId: 'missing' }, { type: 'back' }, {})).toEqual({ kind: 'home' })
  })

  test('normalizes negative and over-bound viewer indices before reducing page actions', () => {
    const negative: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: -1 }
    const overBound: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 99 }
    expect(reduceNavigation(multiGroupBrand, negative, { type: 'page-next' }, {})).toEqual({ ...negative, pageIndex: 1 })
    expect(reduceNavigation(multiGroupBrand, overBound, { type: 'page-previous' }, {})).toEqual({ ...overBound, pageIndex: 1 })
  })

  test('rejects non-integer and non-finite viewer indices to home', () => {
    const decimal: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: 1.5 }
    const infinite: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: Number.POSITIVE_INFINITY }
    const notANumber: Screen = { kind: 'viewer', subjectId: 'multi', groupId: 'first', pageIndex: Number.NaN }
    expect(reduceNavigation(multiGroupBrand, decimal, { type: 'page-select', pageIndex: 99 }, {})).toEqual({ kind: 'home' })
    expect(reduceNavigation(multiGroupBrand, infinite, { type: 'back' }, {})).toEqual({ kind: 'home' })
    expect(reduceNavigation(multiGroupBrand, notANumber, { type: 'page-next' }, {})).toEqual({ kind: 'home' })
  })
})
