import { brandRegistry } from '../src/core/brand-registry'
import { validateBrand } from '../src/core/validate-brand'

const failures = [...brandRegistry.values()].flatMap((brand) =>
  validateBrand(brand).map((issue) => `${brand.id}: ${issue.path} ${issue.message}`),
)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  const count = brandRegistry.size
  console.log(`Validated ${count} brand manifest${count === 1 ? '' : 's'}.`)
}
