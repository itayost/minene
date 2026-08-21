import { describe, expect, test } from 'vitest'
import { mineneBrand } from '../src/brands/minene'
import { getBrand, resolveBrandId } from '../src/core/brand-registry'
import type { BrandManifest } from '../src/core/brand-types'
import { validateBrand } from '../src/core/validate-brand'

const validBrand: BrandManifest = {
  id: 'study-space',
  name: 'Study Space',
  title: 'Study Space Library',
  locale: 'he-IL',
  direction: 'rtl',
  logo: { src: '/brands/study-space/logo.svg', alt: 'Study Space' },
  theme: {
    primary: '#1263a1',
    primaryStrong: '#0d4673',
    text: '#17212b',
    muted: '#5b6773',
    background: '#f4f7f9',
    surface: '#ffffff',
    border: '#d4dce3',
    fontFamily: 'Heebo Variable',
  },
  labels: {
    home: 'Home',
    back: 'Go back',
    navigation: 'Primary navigation',
    share: 'Share',
    save: 'Save',
    whatsapp: 'WhatsApp',
  },
  subjects: [
    {
      id: 'mathematics',
      label: 'Mathematics',
      icon: '/brands/study-space/icons/calculate.svg',
      cardColor: '#d9ebf7',
      groups: [
        {
          id: 'algebra',
          label: 'Algebra',
          icon: '/brands/study-space/icons/algebra.svg',
          pages: [{ src: '/brands/study-space/algebra/1.webp', alt: 'Algebra page 1' }],
        },
      ],
    },
  ],
  tools: [{ id: 'formula-sheet', label: 'Formula sheet', icon: '/brands/study-space/icons/description.svg', items: ['Formulas'] }],
}

describe('validateBrand', () => {
  test('accepts the Minene manifest and resolves its brand route', () => {
    expect(validateBrand(mineneBrand)).toEqual([])
    expect(resolveBrandId('/')).toBe('minene')
    expect(resolveBrandId('/minene')).toBe('minene')
    expect(resolveBrandId('/unknown/')).toBe('unknown')
    expect(getBrand('minene')).toBe(mineneBrand)
  })

  test('accepts a complete valid brand manifest', () => {
    expect(validateBrand(validBrand)).toEqual([])
  })

  test('reports an ID that is not URL-safe', () => {
    expect(validateBrand({ ...validBrand, id: 'Not URL Safe' })[0]?.path).toBe('id')
  })

  test('requires at least one subject', () => {
    expect(validateBrand({ ...validBrand, subjects: [] })).toContainEqual({
      path: 'subjects',
      message: 'must contain at least one subject',
    })
  })

  test('reports duplicate subject IDs', () => {
    expect(validateBrand({ ...validBrand, subjects: [validBrand.subjects[0]!, validBrand.subjects[0]!] })).toContainEqual({
      path: 'subjects[1].id',
      message: 'must be unique',
    })
  })

  test('reports duplicate group IDs within a subject', () => {
    const subject = validBrand.subjects[0]!
    expect(validateBrand({ ...validBrand, subjects: [{ ...subject, groups: [subject.groups[0]!, subject.groups[0]!] }] })).toContainEqual({
      path: 'subjects[0].groups[1].id',
      message: 'must be unique',
    })
  })

  test('requires at least one group for every subject', () => {
    const subject = validBrand.subjects[0]!
    expect(validateBrand({ ...validBrand, subjects: [{ ...subject, groups: [] }] })).toContainEqual({
      path: 'subjects[0].groups',
      message: 'must contain at least one group',
    })
  })

  test('requires at least one page for every group', () => {
    const subject = validBrand.subjects[0]!
    const group = subject.groups[0]!
    expect(validateBrand({ ...validBrand, subjects: [{ ...subject, groups: [{ ...group, pages: [] }] }] })).toContainEqual({
      path: 'subjects[0].groups[0].pages',
      message: 'must contain at least one page',
    })
  })

  test('reports duplicate tool IDs', () => {
    expect(validateBrand({ ...validBrand, tools: [validBrand.tools[0]!, validBrand.tools[0]!] })).toContainEqual({
      path: 'tools[1].id',
      message: 'must be unique',
    })
  })

  test('requires every theme token', () => {
    expect(validateBrand({ ...validBrand, theme: { ...validBrand.theme, primary: '' } })).toContainEqual({
      path: 'theme.primary',
      message: 'is required',
    })
  })

  test.each(['back', 'navigation'] as const)('requires the localized %s accessibility label', (label) => {
    expect(validateBrand({ ...validBrand, labels: { ...validBrand.labels, [label]: '' } })).toContainEqual({
      path: `labels.${label}`,
      message: 'is required',
    })
  })

  test('requires brand-owned asset paths', () => {
    expect(validateBrand({ ...validBrand, logo: { ...validBrand.logo, src: '/brands/other/logo.svg' } })).toContainEqual({
      path: 'logo.src',
      message: 'must begin with /brands/study-space/',
    })
  })

  test('requires brand-owned subject icon paths', () => {
    const subject = validBrand.subjects[0]!
    expect(validateBrand({
      ...validBrand,
      subjects: [{ ...subject, icon: '/brands/other/calculate.svg' }],
    })).toContainEqual({
      path: 'subjects[0].icon',
      message: 'must begin with /brands/study-space/',
    })
  })

  test('requires brand-owned optional group icon paths', () => {
    const subject = validBrand.subjects[0]!
    const group = subject.groups[0]!
    expect(validateBrand({
      ...validBrand,
      subjects: [{ ...subject, groups: [{ ...group, icon: '/brands/other/algebra.svg' }] }],
    })).toContainEqual({
      path: 'subjects[0].groups[0].icon',
      message: 'must begin with /brands/study-space/',
    })
  })

  test('requires brand-owned tool icon paths', () => {
    const tool = validBrand.tools[0]!
    expect(validateBrand({
      ...validBrand,
      tools: [{ ...tool, icon: '/brands/other/description.svg' }],
    })).toContainEqual({
      path: 'tools[0].icon',
      message: 'must begin with /brands/study-space/',
    })
  })
})
