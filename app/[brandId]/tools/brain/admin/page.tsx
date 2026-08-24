import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { AdminClient } from './admin-client'

type AdminParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'נתוני המוח' }

export default async function AdminPage({ params }: AdminParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  // Owner-only, and a 404 rather than a 403 for the same reason an inaccessible
  // brand is a 404: a 403 confirms the page exists to someone who may not have
  // it. The entry point on the tool screen is hidden from staff too, so this is
  // the boundary rather than the only line of defence.
  if (session.role !== 'owner') notFound()

  return <AdminClient />
}
