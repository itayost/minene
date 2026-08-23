import { requireBrand } from '../../src/auth/require-brand'
import { HomeScreen } from '../../src/components/HomeScreen'
import { subjectHref } from '../../src/core/hrefs'

type BrandHomeParams = { params: Promise<{ brandId: string }> }

export default async function BrandHomePage({ params }: BrandHomeParams) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return <HomeScreen subjects={brand.subjects} subjectHref={(id) => subjectHref(brand.id, id)} />
}
