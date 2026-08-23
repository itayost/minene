import { notFound, redirect } from 'next/navigation'
import { requireBrand } from '../../../src/auth/require-brand'
import { SubjectMenu } from '../../../src/components/SubjectMenu'
import { groupHref } from '../../../src/core/hrefs'
import { assertDefined } from '../../../src/core/invariant'
import { resolveScreen } from '../../../src/core/navigation'

type SubjectParams = { params: Promise<{ brandId: string; subjectId: string }> }

/**
 * generateStaticParams is deliberately absent. This route reads cookies to
 * verify the session, which makes it dynamic, so it would be ignored -- and
 * prerendering a tenant's pages onto a CDN is not something to do accidentally
 * now that a brand is a data boundary.
 */

export default async function SubjectPage({ params }: SubjectParams) {
  const { brandId, subjectId } = await params
  const { brand } = await requireBrand(brandId)

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
