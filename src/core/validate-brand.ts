import type { BrandManifest, PageAsset, ValidationIssue } from './brand-types'

const urlSafeId = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

const themeTokens = [
  'primary',
  'primaryStrong',
  'text',
  'muted',
  'background',
  'surface',
  'border',
  'fontFamily',
] as const

const requiredLabelKeys = ['home', 'back', 'navigation', 'share', 'save', 'whatsapp'] as const

export function assertBrandAssetPath(brandId: string, path: string): boolean {
  return path.startsWith(`/brands/${brandId}/`)
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
  const validateAsset = (asset: PageAsset, path: string) => {
    requireValue(asset.alt, `${path}.alt`)
    if (!assertBrandAssetPath(brand.id, asset.src)) {
      addIssue(`${path}.src`, `must begin with /brands/${brand.id}/`)
    }
  }

  validateId(brand.id, 'id')
  requireValue(brand.name, 'name')
  requireValue(brand.title, 'title')
  requireValue(brand.locale, 'locale')
  validateAsset(brand.logo, 'logo')

  for (const token of themeTokens) requireValue(brand.theme[token], `theme.${token}`)
  for (const key of requiredLabelKeys) requireValue(brand.labels[key], `labels.${key}`)

  if (brand.subjects.length === 0) addIssue('subjects', 'must contain at least one subject')
  const subjectIds = new Set<string>()
  brand.subjects.forEach((subject, subjectIndex) => {
    const subjectPath = `subjects[${subjectIndex}]`
    validateId(subject.id, `${subjectPath}.id`)
    if (subjectIds.has(subject.id)) addIssue(`${subjectPath}.id`, 'must be unique')
    subjectIds.add(subject.id)
    requireValue(subject.label, `${subjectPath}.label`)
    requireValue(subject.icon, `${subjectPath}.icon`)
    requireValue(subject.cardColor, `${subjectPath}.cardColor`)

    if (subject.groups.length === 0) addIssue(`${subjectPath}.groups`, 'must contain at least one group')
    const groupIds = new Set<string>()
    subject.groups.forEach((group, groupIndex) => {
      const groupPath = `${subjectPath}.groups[${groupIndex}]`
      validateId(group.id, `${groupPath}.id`)
      if (groupIds.has(group.id)) addIssue(`${groupPath}.id`, 'must be unique')
      groupIds.add(group.id)
      requireValue(group.label, `${groupPath}.label`)

      if (group.pages.length === 0) addIssue(`${groupPath}.pages`, 'must contain at least one page')
      group.pages.forEach((page, pageIndex) => validateAsset(page, `${groupPath}.pages[${pageIndex}]`))
    })
  })

  const toolIds = new Set<string>()
  brand.tools.forEach((tool, toolIndex) => {
    const toolPath = `tools[${toolIndex}]`
    validateId(tool.id, `${toolPath}.id`)
    if (toolIds.has(tool.id)) addIssue(`${toolPath}.id`, 'must be unique')
    toolIds.add(tool.id)
    requireValue(tool.label, `${toolPath}.label`)
    requireValue(tool.icon, `${toolPath}.icon`)
    tool.items.forEach((item, itemIndex) => requireValue(item, `${toolPath}.items[${itemIndex}]`))
  })

  return issues
}
