import { notFound, redirect } from 'next/navigation'
import { SubjectMenu } from '../../../src/components/SubjectMenu'
import { brandManifestEntries, getBrand } from '../../../src/core/brand-registry'
import { groupHref } from '../../../src/core/hrefs'
import { assertDefined } from '../../../src/core/invariant'
import { resolveScreen } from '../../../src/core/navigation'

type SubjectParams = { params: Promise<{ brandId: string; subjectId: string }> }

export function generateStaticParams() {
  return brandManifestEntries.flatMap(([brandId, brand]) =>
    brand.subjects.map((subject) => ({ brandId, subjectId: subject.id })))
}

export default async function SubjectPage({ params }: SubjectParams) {
  const { brandId, subjectId } = await params
  const brand = getBrand(brandId)
  if (!brand) notFound()

  const screen = resolveScreen(brand, [subjectId], null)
  if (!screen || screen.kind !== 'menu') notFound()

  // resolveScreen only returns a `menu` screen for a subject it already found
  // on this brand, so the id it hands back is guaranteed to resolve here too.
  // A miss would mean resolveScreen and this lookup have drifted apart, which
  // is a bug to surface loudly, not a 404 a visitor could ever hit.
  const subject = assertDefined(
    brand.subjects.find((candidate) => candidate.id === screen.subjectId),
    `resolveScreen returned unknown subject "${screen.subjectId}" for brand "${brand.id}"`,
  )

  // A subject with exactly one group never showed a chooser in the single-page
  // application. The equivalent under routing is a redirect to that group.
  const onlyGroup = subject.groups.length === 1 ? subject.groups[0] : undefined
  if (onlyGroup) redirect(groupHref(brand.id, subject.id, onlyGroup.id))

  return (
    <SubjectMenu
      subject={subject}
      groupHref={(groupId) => groupHref(brand.id, subject.id, groupId)}
    />
  )
}
