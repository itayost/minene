import { notFound } from 'next/navigation'
import { ToolScreen } from '../../../../src/components/ToolScreen'
import { brandManifestEntries, getBrand } from '../../../../src/core/brand-registry'
import { resolveScreen } from '../../../../src/core/navigation'
import { TOOLS_SEGMENT } from '../../../../src/core/hrefs'

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

  const tool = brand.tools.find((candidate) => candidate.id === screen.toolId)
  if (!tool) notFound()

  return <ToolScreen tool={tool} />
}
