import type { BrandManifest, PageAsset, ValidationIssue } from './brand-types'

const urlSafeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

// `tools` is a static route segment under /[brandId]/. Next resolves it before
// the dynamic [subjectId] segment, so a subject with this id would be
// permanently unreachable. Tools themselves are unaffected: /minene/tools/tools
// is unambiguous.
export const RESERVED_SUBJECT_IDS: ReadonlySet<string> = new Set(['tools'])

const themeTokens = [
  'primary',
  'primaryStrong',
  'text',
  'muted',
  'background',
  'surface',
  'surfaceSunken',
  'positive',
  'border',
  'fontFamily',
] as const

const requiredLabelKeys = ['home', 'back', 'navigation', 'share', 'save', 'whatsapp'] as const
const requiredFeedbackLabelKeys = [
  'sharedFile',
  'sharedUrl',
  'copied',
  'shareFailed',
  'saved',
  'saveFailed',
  'whatsappOpened',
  'whatsappBlocked',
  'whatsappFailed',
] as const

const assetPathMessage = (brandId: string) =>
  `must be a normalized path beneath /brands/${brandId}/ without dot segments, backslashes, query strings, or fragments`

export function normalizeBrandAssetPath(brandId: string, assetPath: string): string | undefined {
  const requiredPrefix = `/brands/${brandId}/`
  if (
    !assetPath.startsWith(requiredPrefix) ||
    assetPath.includes('\\') ||
    assetPath.includes('?') ||
    assetPath.includes('#')
  ) {
    return undefined
  }

  let parsed: URL
  try {
    parsed = new URL(assetPath, 'https://brand-assets.invalid')
  } catch {
    return undefined
  }

  if (parsed.origin !== 'https://brand-assets.invalid' || parsed.pathname !== assetPath)
    return undefined

  const segments = assetPath.slice(1).split('/')
  if (segments.some((segment) => segment.length === 0)) return undefined

  try {
    if (
      segments.some((segment) => {
        const decoded = decodeURIComponent(segment)
        return (
          decoded === '.' ||
          decoded === '..' ||
          decoded.includes('/') ||
          decoded.includes('\\') ||
          decoded.includes('\0')
        )
      })
    )
      return undefined
  } catch {
    return undefined
  }

  return parsed.pathname
}

export function assertBrandAssetPath(brandId: string, path: string): boolean {
  return normalizeBrandAssetPath(brandId, path) !== undefined
}

export function validateBrand(brand: BrandManifest): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const addIssue = (path: string, message: string) => issues.push({ path, message })
  const requireValue = (value: string, path: string) => {
    if (!value.trim()) addIssue(path, 'is required')
  }
  const validateId = (value: string, path: string) => {
    if (!urlSafeId.test(value)) addIssue(path, 'must be URL-safe')
  }
  const validateAssetPath = (src: string, path: string) => {
    requireValue(src, path)
    if (!src.startsWith(`/brands/${brand.id}/`)) {
      addIssue(path, `must begin with /brands/${brand.id}/`)
    } else if (!assertBrandAssetPath(brand.id, src)) {
      addIssue(path, assetPathMessage(brand.id))
    }
  }
  const validateAsset = (asset: PageAsset, path: string) => {
    requireValue(asset.alt, `${path}.alt`)
    validateAssetPath(asset.src, `${path}.src`)
  }

  validateId(brand.id, 'id')
  requireValue(brand.name, 'name')
  requireValue(brand.title, 'title')
  requireValue(brand.locale, 'locale')
  validateAsset(brand.logo, 'logo')

  for (const token of themeTokens) requireValue(brand.theme[token], `theme.${token}`)
  for (const key of requiredLabelKeys) requireValue(brand.labels[key], `labels.${key}`)
  for (const key of requiredFeedbackLabelKeys)
    requireValue(brand.labels.feedback?.[key] ?? '', `labels.feedback.${key}`)

  if (brand.subjects.length === 0) addIssue('subjects', 'must contain at least one subject')
  const subjectIds = new Set<string>()
  brand.subjects.forEach((subject, subjectIndex) => {
    const subjectPath = `subjects[${subjectIndex}]`
    validateId(subject.id, `${subjectPath}.id`)
    if (RESERVED_SUBJECT_IDS.has(subject.id)) {
      addIssue(`${subjectPath}.id`, 'must not be a reserved identifier')
    }
    if (subjectIds.has(subject.id)) addIssue(`${subjectPath}.id`, 'must be unique')
    subjectIds.add(subject.id)
    requireValue(subject.label, `${subjectPath}.label`)
    validateAssetPath(subject.icon, `${subjectPath}.icon`)
    requireValue(subject.cardColor, `${subjectPath}.cardColor`)

    if (subject.groups.length === 0)
      addIssue(`${subjectPath}.groups`, 'must contain at least one group')
    const groupIds = new Set<string>()
    subject.groups.forEach((group, groupIndex) => {
      const groupPath = `${subjectPath}.groups[${groupIndex}]`
      validateId(group.id, `${groupPath}.id`)
      if (groupIds.has(group.id)) addIssue(`${groupPath}.id`, 'must be unique')
      groupIds.add(group.id)
      requireValue(group.label, `${groupPath}.label`)
      if (group.icon !== undefined) validateAssetPath(group.icon, `${groupPath}.icon`)

      if (group.pages.length === 0) addIssue(`${groupPath}.pages`, 'must contain at least one page')
      group.pages.forEach((page, pageIndex) =>
        validateAsset(page, `${groupPath}.pages[${pageIndex}]`),
      )
    })
  })

  const toolIds = new Set<string>()
  brand.tools.forEach((tool, toolIndex) => {
    const toolPath = `tools[${toolIndex}]`
    validateId(tool.id, `${toolPath}.id`)
    if (toolIds.has(tool.id)) addIssue(`${toolPath}.id`, 'must be unique')
    toolIds.add(tool.id)
    requireValue(tool.label, `${toolPath}.label`)
    validateAssetPath(tool.icon, `${toolPath}.icon`)
    tool.items.forEach((item, itemIndex) => requireValue(item, `${toolPath}.items[${itemIndex}]`))
  })

  return issues
}
