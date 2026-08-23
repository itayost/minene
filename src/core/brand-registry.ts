import { mineneBrand } from '../brands/minene'
import type { BrandManifest } from './brand-types'

export type BrandRegistration = readonly [key: string, manifest: BrandManifest]

export function validateBrandRegistrations(registrations: readonly BrandRegistration[]): string[] {
  const issues: string[] = []
  const keys = new Set<string>()
  const manifestIds = new Set<string>()

  for (const [key, manifest] of registrations) {
    if (keys.has(key)) issues.push(`duplicate registry key "${key}"`)
    keys.add(key)

    if (manifestIds.has(manifest.id)) issues.push(`duplicate manifest id "${manifest.id}"`)
    manifestIds.add(manifest.id)

    if (key !== manifest.id) {
      issues.push(`registry key "${key}" must match manifest id "${manifest.id}"`)
    }
  }

  return issues
}

export function buildBrandRegistry(registrations: readonly BrandRegistration[]): ReadonlyMap<string, BrandManifest> {
  const issues = validateBrandRegistrations(registrations)
  if (issues.length > 0) throw new Error(`Invalid brand registry:\n- ${issues.join('\n- ')}`)
  return new Map(registrations)
}

export const brandManifestEntries = [
  [mineneBrand.id, mineneBrand],
] as const satisfies readonly BrandRegistration[]

export const brandRegistry = buildBrandRegistry(brandManifestEntries)

export const getBrand = (id: string) => brandRegistry.get(id)

export const DEFAULT_BRAND_ID = 'minene'

export const resolveBrandId = (pathname: string) => {
  const first = pathname.split('/').filter(Boolean)[0]
  return first || DEFAULT_BRAND_ID
}
