import { requireBrand } from '../../../../src/auth/require-brand'
import { VideoWizard } from './video-wizard'

type VideoParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'יצירת סרטון הדרכה' }

export default async function VideoPage({ params }: VideoParams) {
  const { brandId } = await params
  const { brand } = await requireBrand(brandId)

  return <VideoWizard backHref={`/${brand.id}`} />
}
