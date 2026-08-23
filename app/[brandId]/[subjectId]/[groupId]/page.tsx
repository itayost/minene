import { notFound } from 'next/navigation'
import { brandManifestEntries, getBrand } from '../../../../src/core/brand-registry'
import { assertDefined } from '../../../../src/core/invariant'
import { resolveScreen } from '../../../../src/core/navigation'
import { ViewerClient } from './viewer-client'

type ViewerParams = {
  params: Promise<{ brandId: string; subjectId: string; groupId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Next currently ignores this: awaiting searchParams to honour ?page= makes the
 * route dynamic, so nothing is prerendered from it. It is kept because it
 * encodes the correct set of params should the route ever become statically
 * renderable.
 */
export function generateStaticParams() {
  return brandManifestEntries.flatMap(([brandId, brand]) =>
    brand.subjects.flatMap((subject) =>
      subject.groups.map((group) => ({ brandId, subjectId: subject.id, groupId: group.id }))))
}

export default async function ViewerPage({ params, searchParams }: ViewerParams) {
  const { brandId, subjectId, groupId } = await params
  const query = await searchParams
  const brand = getBrand(brandId)
  if (!brand) notFound()

  const rawPage = query.page
  const pageParam = typeof rawPage === 'string' ? rawPage : null

  const screen = resolveScreen(brand, [subjectId, groupId], pageParam)
  if (!screen || screen.kind !== 'viewer') notFound()

  // resolveScreen only returns a `viewer` screen for a subject and group it
  // already found on this brand, so both ids are guaranteed to resolve here
  // too. A miss would mean resolveScreen and this lookup have drifted apart,
  // which is a bug to surface loudly, not a 404 a visitor could ever hit.
  const subject = assertDefined(
    brand.subjects.find((candidate) => candidate.id === screen.subjectId),
    `resolveScreen returned unknown subject "${screen.subjectId}" for brand "${brand.id}"`,
  )
  const group = assertDefined(
    subject.groups.find((candidate) => candidate.id === screen.groupId),
    `resolveScreen returned unknown group "${screen.groupId}" for subject "${subject.id}"`,
  )

  return (
    <ViewerClient
      brand={brand}
      subjectId={screen.subjectId}
      group={group}
      pageIndex={screen.pageIndex}
      hasExplicitPage={pageParam !== null}
    />
  )
}
