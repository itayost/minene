import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { IngestClient } from './ingest-client'

type IngestParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'הזנת ידע' }

/**
 * Owner-only, because the database says so: every documents policy and every
 * pending-rule read behind this screen requires the owner role, and
 * hunt-external checks it server-side too. Without the gate RLS silently
 * filters every row and the page states as fact that the queue is empty when it
 * may be full -- a confident false statement, which is worse than an absence.
 */
export default async function IngestPage({ params }: IngestParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  if (session.role !== 'owner') notFound()

  return <IngestClient tenantId={session.tenantId} />
}
