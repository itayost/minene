import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { listPersonaOptions, loadPlans } from '../../../../../src/persuade/lib/content'
import { workerSettings } from '../../../../../src/persuade/lib/worker-settings'
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

  // Read here rather than through an endpoint. This is a server component with
  // the service key already in hand, so a route to list them would be a network
  // hop to make the same two queries this render can make directly -- and it
  // would put the persona list behind an endpoint that has to re-establish who
  // is allowed to see it.
  const [personas, plans] = await Promise.all([listPersonaOptions(), loadPlans()])

  return (
    // useSearchParams needs a Suspense boundary above it, otherwise the whole
    // route opts out of static rendering with a build-time warning.
    <Suspense fallback={<p className="knowledge-message">טוען את המעבדה…</p>}>
      <LabClient dailyCap={workerSettings().dailyCap} personas={personas} plans={plans} />
    </Suspense>
  )
}
