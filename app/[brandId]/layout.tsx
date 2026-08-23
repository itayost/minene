import type { Metadata, Viewport } from 'next'
import { Suspense, type ReactNode } from 'react'
import { BrandNotFound } from '../../src/components/BrandNotFound'
import { brandManifestEntries, getBrand } from '../../src/core/brand-registry'
import { BrandShellClient } from './brand-shell-client'

type BrandParams = { params: Promise<{ brandId: string }> }

export function generateStaticParams() {
  return brandManifestEntries.map(([brandId]) => ({ brandId }))
}

export async function generateMetadata({ params }: BrandParams): Promise<Metadata> {
  const { brandId } = await params
  const brand = getBrand(brandId)
  return brand ? { title: brand.title } : { title: 'Brand not found' }
}

export async function generateViewport({ params }: BrandParams): Promise<Viewport> {
  const { brandId } = await params
  const brand = getBrand(brandId)
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    themeColor: brand?.theme.background ?? '#e9e9ee',
  }
}

export default async function BrandLayout({ children, params }: BrandParams & { children: ReactNode }) {
  const { brandId } = await params
  const brand = getBrand(brandId)

  // Rendered here rather than in app/not-found.tsx because naming the brand that
  // was requested needs the param, and a global not-found receives none.
  if (!brand) return <BrandNotFound brandId={brandId} />

  // The shell reads ?page= to keep the header in step with the viewer, and a
  // client component that reads search params has to sit under a boundary or the
  // static build refuses. The fallback is empty rather than a second shell: any
  // placeholder shell would have to guess the screen, and guessing wrong paints
  // the wrong header for a frame on every route below this one.
  return (
    <Suspense fallback={null}>
      <BrandShellClient brand={brand}>{children}</BrandShellClient>
    </Suspense>
  )
}
