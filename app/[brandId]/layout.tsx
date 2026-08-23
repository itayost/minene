import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import { requireBrand, resolveUserBrand } from '../../src/auth/require-brand'
import { BrandShellClient } from './brand-shell-client'

type BrandParams = { params: Promise<{ brandId: string }> }

/**
 * generateStaticParams is deliberately absent. Every route beneath this layout
 * reads cookies to verify the session, which makes them dynamic, so it would be
 * ignored -- and prerendering a tenant's pages onto a CDN is not something to do
 * accidentally now that a brand is a data boundary.
 */

/**
 * Metadata must not confirm a brand the caller may not access. Reading the
 * manifest directly would return the real title and theme colour beside a 404
 * that denies the same brand exists, which is exactly the enumeration the 404
 * rule prevents.
 *
 * The try/catch is load-bearing: resolveUserBrand redirects by throwing, and a
 * metadata function is not a place to navigate. Falling back to the generic
 * title is correct, because the layout itself redirects a moment later.
 */
async function brandForMetadata(params: BrandParams['params']) {
  const { brandId } = await params
  try {
    const { brand } = await resolveUserBrand()
    return brand.id === brandId ? brand : null
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: BrandParams): Promise<Metadata> {
  const brand = await brandForMetadata(params)
  return { title: brand?.title ?? 'Brand not found' }
}

export async function generateViewport({ params }: BrandParams): Promise<Viewport> {
  const brand = await brandForMetadata(params)
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: brand?.theme.background ?? '#e9e9ee',
  }
}

export default async function BrandLayout({ children, params }: BrandParams & { children: ReactNode }) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return <BrandShellClient brand={brand}>{children}</BrandShellClient>
}
