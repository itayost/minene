import { notFound } from 'next/navigation'
import { requireBrand } from '../../../../../src/auth/require-brand'
import { LobbyClient } from './lobby-client'

type LobbyParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'לובי אושר' }

export default async function LobbyPage({ params }: LobbyParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  // Owner-only, because the database says so: rules_select_owner and
  // rules_update_owner both require the owner role, and list_pending_rules is
  // security invoker so it inherits that. Without this gate RLS silently filters
  // every row on select and a staff member is told "0 חוקים ממתינים לאישור" --
  // a confident false statement about an empty queue, which is worse than an
  // absence. A 404 rather than a 403, consistent with every other resource the
  // caller may not have.
  if (session.role !== 'owner') notFound()

  return <LobbyClient />
}
