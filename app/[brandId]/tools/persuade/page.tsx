import { requireBrand } from '../../../../src/auth/require-brand'
import { PersuadeClient } from './persuade-client'

type PersuadeParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'משכנע' }

/**
 * A static segment, so Next resolves it before the sibling [toolId] route --
 * the same rule that already makes `tools` beat `[subjectId]` and `brain` beat
 * `[toolId]`. `קמפיינר` keeps being served by [toolId] entirely unchanged.
 *
 * No role gate. Every member has assignments addressed to them, and
 * assignments_select_own is what decides whose rows come back. An owner gets
 * the tenant's, which is the right answer for a manager view.
 */
export default async function PersuadePage({ params }: PersuadeParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  return <PersuadeClient brandId={brandId} role={session.role} />
}
