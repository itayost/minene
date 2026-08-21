import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import type { BrandManifest } from '../src/core/brand-types'
import { validateRegisteredBrands } from '../scripts/validate-brands'
import { demoBrand } from './fixtures/demo-brand'

const projectRoot = process.cwd()
const temporaryRoots: string[] = []

function temporaryPublicRoot() {
  const root = mkdtempSync(join(tmpdir(), 'brand-assets-'))
  temporaryRoots.push(root)
  return root
}

function brandUsing(src: string): BrandManifest {
  const subject = demoBrand.subjects[0]!
  const group = subject.groups[0]!
  return {
    ...demoBrand,
    logo: { src, alt: 'Independent demo logo' },
    subjects: [{
      ...subject,
      icon: src,
      groups: [{ ...group, icon: src, pages: [{ src, alt: 'Demo page' }] }],
    }],
    tools: [],
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('validate:brands', () => {
  test('succeeds for the production brand registry', () => {
    const result = spawnSync('pnpm', ['validate:brands'], {
      cwd: projectRoot,
      encoding: 'utf8',
    })

    expect(result.status).toBe(0)
  })

  test.each([
    '/brands/demo/../other/secret.png',
    '/brands/demo/icons/..\\other\\secret.png',
  ])('rejects traversal even when the escaped target exists: %s', (src) => {
    const publicRoot = temporaryPublicRoot()
    mkdirSync(join(publicRoot, 'brands', 'other'), { recursive: true })
    writeFileSync(join(publicRoot, 'brands', 'other', 'secret.png'), 'secret')

    const failures = validateRegisteredBrands([['demo', brandUsing(src)]], publicRoot)

    expect(failures).toContain(`demo: unsafe asset ${src}`)
  })

  test('rejects an existing asset owned by a different brand', () => {
    const publicRoot = temporaryPublicRoot()
    const crossBrandAsset = '/brands/other/icons/logo.svg'
    mkdirSync(join(publicRoot, 'brands', 'other', 'icons'), { recursive: true })
    writeFileSync(join(publicRoot, 'brands', 'other', 'icons', 'logo.svg'), '<svg/>')

    const failures = validateRegisteredBrands([['demo', brandUsing(crossBrandAsset)]], publicRoot)

    expect(failures).toContain(`demo: unsafe asset ${crossBrandAsset}`)
  })

  test('requires an asset target to be a regular file', () => {
    const publicRoot = temporaryPublicRoot()
    const directoryAsset = '/brands/demo/icons/logo.svg'
    mkdirSync(join(publicRoot, 'brands', 'demo', 'icons', 'logo.svg'), { recursive: true })

    const failures = validateRegisteredBrands([['demo', brandUsing(directoryAsset)]], publicRoot)

    expect(failures).toContain(`demo: asset is not a regular file ${directoryAsset}`)
  })
})
