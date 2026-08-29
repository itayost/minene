import { describe, expect, test } from 'vitest'
import { mineneBrand } from '../src/brands/minene'
import { buildBrandRegistry, getBrand } from '../src/core/brand-registry'
import type { BrandManifest } from '../src/core/brand-types'
import { validateBrand } from '../src/core/validate-brand'
import { demoBrand } from './fixtures/demo-brand'

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
    surfaceSunken: '#f2f6f9',
    positive: '#0f6f66',
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
    feedback: {
      sharedFile: 'Shared image',
      sharedUrl: 'Shared link',
      copied: 'Copied link',
      shareFailed: 'Share failed',
      saved: 'Saved image',
      saveFailed: 'Save failed',
      whatsappOpened: 'Opened WhatsApp',
      whatsappBlocked: 'WhatsApp blocked',
      whatsappFailed: 'WhatsApp failed',
    },
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
  tools: [
    {
      id: 'formula-sheet',
      label: 'Formula sheet',
      icon: '/brands/study-space/icons/description.svg',
      items: ['Formulas'],
    },
  ],
}

describe('validateBrand', () => {
  test('accepts the Minene manifest and registers it under its brand ID', () => {
    expect(validateBrand(mineneBrand)).toEqual([])
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
    expect(
      validateBrand({
        ...validBrand,
        subjects: [validBrand.subjects[0]!, validBrand.subjects[0]!],
      }),
    ).toContainEqual({
      path: 'subjects[1].id',
      message: 'must be unique',
    })
  })

  test('reports duplicate group IDs within a subject', () => {
    const subject = validBrand.subjects[0]!
    expect(
      validateBrand({
        ...validBrand,
        subjects: [{ ...subject, groups: [subject.groups[0]!, subject.groups[0]!] }],
      }),
    ).toContainEqual({
      path: 'subjects[0].groups[1].id',
      message: 'must be unique',
    })
  })

  test('requires at least one group for every subject', () => {
    const subject = validBrand.subjects[0]!
    expect(validateBrand({ ...validBrand, subjects: [{ ...subject, groups: [] }] })).toContainEqual(
      {
        path: 'subjects[0].groups',
        message: 'must contain at least one group',
      },
    )
  })

  test('requires at least one page for every group', () => {
    const subject = validBrand.subjects[0]!
    const group = subject.groups[0]!
    expect(
      validateBrand({
        ...validBrand,
        subjects: [{ ...subject, groups: [{ ...group, pages: [] }] }],
      }),
    ).toContainEqual({
      path: 'subjects[0].groups[0].pages',
      message: 'must contain at least one page',
    })
  })

  test('reports duplicate tool IDs', () => {
    expect(
      validateBrand({ ...validBrand, tools: [validBrand.tools[0]!, validBrand.tools[0]!] }),
    ).toContainEqual({
      path: 'tools[1].id',
      message: 'must be unique',
    })
  })

  test('requires every theme token', () => {
    expect(
      validateBrand({ ...validBrand, theme: { ...validBrand.theme, primary: '' } }),
    ).toContainEqual({
      path: 'theme.primary',
      message: 'is required',
    })
  })

  test.each([
    'back',
    'navigation',
  ] as const)('requires the localized %s accessibility label', (label) => {
    expect(
      validateBrand({ ...validBrand, labels: { ...validBrand.labels, [label]: '' } }),
    ).toContainEqual({
      path: `labels.${label}`,
      message: 'is required',
    })
  })

  test('requires brand-owned asset paths', () => {
    expect(
      validateBrand({ ...validBrand, logo: { ...validBrand.logo, src: '/brands/other/logo.svg' } }),
    ).toContainEqual({
      path: 'logo.src',
      message: 'must begin with /brands/study-space/',
    })
  })

  test.each([
    '/brands/study-space/pages/../secret.png',
    '/brands/study-space/pages/%2e%2e/secret.png',
    '/brands/study-space/pages\\secret.png',
    '/brands/study-space/pages//page.png',
    '/brands/study-space/pages/page.png?download=1',
    '/brands/study-space/pages/page.png#preview',
  ])('rejects an unsafe or non-normalized asset path: %s', (src) => {
    expect(validateBrand({ ...validBrand, logo: { ...validBrand.logo, src } })).toContainEqual({
      path: 'logo.src',
      message:
        'must be a normalized path beneath /brands/study-space/ without dot segments, backslashes, query strings, or fragments',
    })
  })

  test('requires brand-owned subject icon paths', () => {
    const subject = validBrand.subjects[0]!
    expect(
      validateBrand({
        ...validBrand,
        subjects: [{ ...subject, icon: '/brands/other/calculate.svg' }],
      }),
    ).toContainEqual({
      path: 'subjects[0].icon',
      message: 'must begin with /brands/study-space/',
    })
  })

  test('requires brand-owned optional group icon paths', () => {
    const subject = validBrand.subjects[0]!
    const group = subject.groups[0]!
    expect(
      validateBrand({
        ...validBrand,
        subjects: [{ ...subject, groups: [{ ...group, icon: '/brands/other/algebra.svg' }] }],
      }),
    ).toContainEqual({
      path: 'subjects[0].groups[0].icon',
      message: 'must begin with /brands/study-space/',
    })
  })

  test('requires brand-owned tool icon paths', () => {
    const tool = validBrand.tools[0]!
    expect(
      validateBrand({
        ...validBrand,
        tools: [{ ...tool, icon: '/brands/other/description.svg' }],
      }),
    ).toContainEqual({
      path: 'tools[0].icon',
      message: 'must begin with /brands/study-space/',
    })
  })

  test('rejects a subject using the reserved tools identifier', () => {
    const brand: BrandManifest = {
      ...demoBrand,
      subjects: [{ ...demoBrand.subjects[0]!, id: 'tools' }],
    }

    const issues = validateBrand(brand)

    expect(issues).toContainEqual({
      path: 'subjects[0].id',
      message: 'must not be a reserved identifier',
    })
  })

  test('accepts a tool using the identifier tools', () => {
    const brand: BrandManifest = {
      ...demoBrand,
      tools: [{ ...demoBrand.tools[0]!, id: 'tools' }],
    }

    const issues = validateBrand(brand)

    expect(issues).not.toContainEqual(expect.objectContaining({ path: 'tools[0].id' }))
  })
})

describe('buildBrandRegistry', () => {
  test('rejects duplicate manifest IDs before constructing a Map', () => {
    expect(() =>
      buildBrandRegistry([
        ['study-space', validBrand],
        ['study-space', { ...validBrand, name: 'Duplicate Study Space' }],
      ]),
    ).toThrow('duplicate manifest id "study-space"')
  })

  test('rejects a registry key that disagrees with its manifest ID', () => {
    expect(() => buildBrandRegistry([['study-space-alias', validBrand]])).toThrow(
      'registry key "study-space-alias" must match manifest id "study-space"',
    )
  })
})

describe('the semantic surface tokens', () => {
  test('refuses a brand with no sunken surface', () => {
    const brand = {
      ...validBrand,
      theme: { ...validBrand.theme, surfaceSunken: '' },
    } as BrandManifest

    // A missing token used to fall through to whatever hex was written beside
    // the var() call, which is how the brain ended up painted in three
    // palettes. Failing the build is the point of naming them here.
    expect(validateBrand(brand).map((issue) => issue.path)).toContain('theme.surfaceSunken')
  })

  test('refuses a brand with no positive colour', () => {
    const brand = {
      ...validBrand,
      theme: { ...validBrand.theme, positive: '' },
    } as BrandManifest

    expect(validateBrand(brand).map((issue) => issue.path)).toContain('theme.positive')
  })
})
