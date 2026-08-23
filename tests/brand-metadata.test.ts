import { describe, expect, it } from 'vitest'
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
