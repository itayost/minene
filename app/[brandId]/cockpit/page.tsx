import { redirect } from 'next/navigation'

/**
 * The cockpit is the brand home now. This stays so links and bookmarks to the
 * old address keep working instead of 404ing.
 */
export default async function CockpitPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params
  redirect(`/${brandId}`)
}
