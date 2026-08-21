import { mineneBrand } from '../brands/minene'
import type { BrandManifest } from './brand-types'

export const brandRegistry: ReadonlyMap<string, BrandManifest> = new Map([[mineneBrand.id, mineneBrand]] as const)

export const getBrand = (id: string) => brandRegistry.get(id)

export const resolveBrandId = (pathname: string) => {
  const first = pathname.split('/').filter(Boolean)[0]
  return first || 'minene'
}
