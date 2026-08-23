import { notFound } from 'next/navigation'
import { ToolScreen } from '../../../../src/components/ToolScreen'
import { brandManifestEntries, getBrand } from '../../../../src/core/brand-registry'
import { TOOLS_SEGMENT } from '../../../../src/core/hrefs'
import { assertDefined } from '../../../../src/core/invariant'
import { resolveScreen } from '../../../../src/core/navigation'

export function generateStaticParams() {
  return brandManifestEntries.flatMap(([brandId, brand]) =>
    brand.tools.map((tool) => ({ brandId, toolId: tool.id })))
}

export default async function ToolPage({ params }: { params: Promise<{ brandId: string; toolId: string }> }) {
  const { brandId, toolId } = await params
  const brand = getBrand(brandId)
  if (!brand) notFound()

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
