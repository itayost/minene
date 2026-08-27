import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { LabClient } from './lab-client'

type LabParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'מעבדת השכנוע' }

/**
 * Owner only, and this gate is a spend control rather than a privacy one.
 *
 * The simulations table is deliberately readable by every signed-in member of
 * any tenant -- that is what makes a cross-industry matrix possible, and there
 * is nothing private in an invented conversation to protect. What is gated is
 * running one, because every run costs model calls.
 */
export default async function LabPage({ params }: LabParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  if (session.role !== 'owner') notFound()

  return <LabClient />
}
