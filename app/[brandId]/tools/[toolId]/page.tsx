import { notFound } from 'next/navigation'
import { ToolScreen } from '../../../../src/components/ToolScreen'
import { requireBrand } from '../../../../src/auth/require-brand'
import { TOOLS_SEGMENT } from '../../../../src/core/hrefs'
import { assertDefined } from '../../../../src/core/invariant'
import { resolveScreen } from '../../../../src/core/navigation'

type ToolParams = { params: Promise<{ brandId: string; toolId: string }> }

/**
 * generateStaticParams is deliberately absent. This route reads cookies to
 * verify the session, which makes it dynamic, so it would be ignored -- and
 * prerendering a tenant's pages onto a CDN is not something to do accidentally
 * now that a brand is a data boundary.
 */

export default async function ToolPage({ params }: ToolParams) {
  const { brandId, toolId } = await params
  const { brand } = await requireBrand(brandId)

  const screen = resolveScreen(brand, [TOOLS_SEGMENT, toolId], null)
  if (!screen || screen.kind !== 'tool') notFound()

  // resolveScreen only returns a `tool` screen for a tool it already found on
  // this brand, so the id it hands back is guaranteed to resolve here too. A
  // miss would mean resolveScreen and this lookup have drifted apart, which
  // is a bug to surface loudly, not a 404 a visitor could ever hit.
  const tool = assertDefined(
    brand.tools.find((candidate) => candidate.id === screen.toolId),
    `resolveScreen returned unknown tool "${screen.toolId}" for brand "${brand.id}"`,
  )

  return <ToolScreen tool={tool} />
}
