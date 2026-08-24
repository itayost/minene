import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { ExtractClient } from './extract-client'

type ExtractParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'חילוץ חוקים' }

export default async function ExtractPage({ params }: ExtractParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  // Owner-only: documents_select_owner and documents_bucket_insert_owner both
  // require the owner role, so without this a staff member reaches the form and
  // gets 'העלאת הקובץ נכשלה. נסי שוב.' -- an endlessly retryable dead end with
  // no explanation.
  if (session.role !== 'owner') notFound()

  // The tenant id comes from the verified session and is passed down as a prop.
  // uploadDocument needs it to build the storage path the policy matches on, and
  // it must never come from user input.
  return <ExtractClient tenantId={session.tenantId} />
}
