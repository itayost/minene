import { describe, expect, it, vi } from 'vitest'

// Metadata resolves through the session now, so that it cannot confirm a brand
// the caller may not access. Standing the session in keeps these tests about
// what the metadata says rather than about authentication.
vi.mock('../src/auth/require-brand', async () => {
  const actual = await vi.importActual<typeof import('../src/core/brand-registry')>(
    '../src/core/brand-registry',
  )
  return {
    LOGIN_PATH: '/login',
    requireBrand: vi.fn(),
    resolveUserBrand: vi.fn(async () => {
      const brand = actual.getBrand('minene')
      if (!brand) throw new Error('minene must be registered for this fixture')
      return { brand, session: { tenantId: 'tenant-1', role: 'owner' as const, brandId: brand.id } }
    }),
  }
})
import { generateMetadata, generateViewport } from '../app/[brandId]/layout'
import { mineneBrand } from '../src/brands/minene'

// The brand title moved out of BrandShell's effect and into generateMetadata,
// so it now reaches the served HTML rather than being applied after hydration.
describe('brand route metadata', () => {
  it('returns the brand title for a configured brand', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ brandId: mineneBrand.id }) })

    expect(metadata).toEqual({ title: mineneBrand.title })
  })

  it('falls back to a generic title for an unknown brand', async () => {
    const metadata = await generateMetadata({ params: Promise.resolve({ brandId: 'not-configured' }) })

    expect(metadata).toEqual({ title: 'Brand not found' })
  })

  it('publishes the brand background as the theme colour', async () => {
    const viewport = await generateViewport({ params: Promise.resolve({ brandId: mineneBrand.id }) })

    expect(viewport.themeColor).toBe(mineneBrand.theme.background)
    expect(viewport).toMatchObject({ width: 'device-width', initialScale: 1, viewportFit: 'cover' })
  })

  it('falls back to the default theme colour for an unknown brand', async () => {
    const viewport = await generateViewport({ params: Promise.resolve({ brandId: 'not-configured' }) })

    expect(viewport.themeColor).toBe('#e9e9ee')
  })
})
