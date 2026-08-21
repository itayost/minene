import { lstatSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  brandManifestEntries,
  validateBrandRegistrations,
  type BrandRegistration,
} from '../src/core/brand-registry'
import type { BrandManifest } from '../src/core/brand-types'
import { normalizeBrandAssetPath, validateBrand } from '../src/core/validate-brand'

function collectAssetPaths(brand: BrandManifest): string[] {
  return [
    brand.logo.src,
    ...brand.subjects.flatMap((subject) => [
      subject.icon,
      ...subject.groups.flatMap((group) => [
        ...(group.icon ? [group.icon] : []),
        ...group.pages.map((page) => page.src),
      ]),
    ]),
    ...brand.tools.map((tool) => tool.icon),
  ]
}

function resolveBrandAsset(publicRoot: string, brandId: string, assetPath: string): string | undefined {
  const normalizedPath = normalizeBrandAssetPath(brandId, assetPath)
  if (!normalizedPath) return undefined

  const brandRoot = resolve(publicRoot, 'brands', brandId)
  const relativeAssetPath = normalizedPath.slice(`/brands/${brandId}/`.length)
  const resolvedAsset = resolve(brandRoot, ...relativeAssetPath.split('/'))
  const relativeToBrand = relative(brandRoot, resolvedAsset)
  if (
    relativeToBrand.length === 0
    || relativeToBrand === '..'
    || relativeToBrand.startsWith(`..${sep}`)
    || isAbsolute(relativeToBrand)
  ) return undefined

  return resolvedAsset
}

export function validateRegisteredBrands(
  registrations: readonly BrandRegistration[],
  publicRoot = resolve(process.cwd(), 'public'),
): string[] {
  const failures = validateBrandRegistrations(registrations).map((issue) => `registry: ${issue}`)

  for (const [, brand] of registrations) {
    failures.push(...validateBrand(brand).map((issue) => `${brand.id}: ${issue.path} ${issue.message}`))

    for (const assetPath of new Set(collectAssetPaths(brand))) {
      const publicFile = resolveBrandAsset(publicRoot, brand.id, assetPath)
      if (!publicFile) {
        failures.push(`${brand.id}: unsafe asset ${assetPath}`)
        continue
      }

      try {
        if (!lstatSync(publicFile).isFile()) {
          failures.push(`${brand.id}: asset is not a regular file ${assetPath}`)
        }
      } catch {
        failures.push(`${brand.id}: missing asset ${assetPath}`)
      }
    }
  }

  return failures
}

function run() {
  const failures = validateRegisteredBrands(brandManifestEntries)

  if (failures.length > 0) {
    console.error(`Brand validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
    process.exitCode = 1
    return
  }

  const count = brandManifestEntries.length
  console.log(`Validated ${count} brand manifest${count === 1 ? '' : 's'}.`)
}

const entryPoint = process.argv[1] ? resolve(process.argv[1]) : undefined
if (entryPoint === fileURLToPath(import.meta.url)) run()
