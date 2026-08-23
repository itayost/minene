import { notFound } from 'next/navigation'
import { HomeScreen } from '../../src/components/HomeScreen'
import { getBrand } from '../../src/core/brand-registry'
import { subjectHref } from '../../src/core/hrefs'

export default async function BrandHomePage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  const brand = getBrand(brandId)
  if (!brand) notFound()

  return <HomeScreen subjects={brand.subjects} subjectHref={(id) => subjectHref(brand.id, id)} />
}
