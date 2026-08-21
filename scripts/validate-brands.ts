import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { brandRegistry } from '../src/core/brand-registry'
import { validateBrand } from '../src/core/validate-brand'

const failures: string[] = []

for (const brand of brandRegistry.values()) {
  failures.push(...validateBrand(brand).map((issue) => `${brand.id}: ${issue.path} ${issue.message}`))

  const assetPaths = [
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

  for (const assetPath of assetPaths) {
    const publicFile = resolve(process.cwd(), 'public', assetPath.replace(/^\//, ''))
    if (!existsSync(publicFile)) failures.push(`${brand.id}: missing asset ${assetPath}`)
  }
}

if (failures.length > 0) {
  console.error(`Brand validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`)
  process.exitCode = 1
} else {
  const count = brandRegistry.size
  console.log(`Validated ${count} brand manifest${count === 1 ? '' : 's'}.`)
}
