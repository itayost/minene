import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
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

  // A missing brand is a missing resource, so it answers 404 rather than 200.
  // The not-found boundary recovers the requested id from the URL, which keeps
  // the message specific without costing the status code.
  if (!brand) notFound()

  return <BrandShellClient brand={brand}>{children}</BrandShellClient>
}
