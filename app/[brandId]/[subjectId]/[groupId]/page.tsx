import { notFound } from 'next/navigation'
import { brandManifestEntries, getBrand } from '../../../../src/core/brand-registry'
import { resolveScreen } from '../../../../src/core/navigation'
import { ViewerClient } from './viewer-client'

type ViewerParams = {
  params: Promise<{ brandId: string; subjectId: string; groupId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Every real group. Honouring ?page= means reading searchParams, a request-time
 * API, so Next serves this route dynamically and does not prerender these today.
 * They are kept because they stay the correct set, and prerendering resumes the
 * moment the page position stops coming from the query.
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

  const subject = brand.subjects.find((candidate) => candidate.id === screen.subjectId)
  const group = subject?.groups.find((candidate) => candidate.id === screen.groupId)
  if (!group) notFound()

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
