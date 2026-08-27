import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { listPersonaOptions, loadPlans } from '../../../../../src/persuade/lib/content'
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

  // Read here rather than through an endpoint: both are committed files under
  // content/, so a route to list them would be a network hop to read the same
  // JSON this render already has on disk.
  const [personas, plans] = await Promise.all([listPersonaOptions(), loadPlans()])

  return <LabClient personas={personas} plans={plans} />
}
