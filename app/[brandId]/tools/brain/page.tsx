import { requireBrand } from '../../../../src/auth/require-brand'
import { BookClient } from './book-client'

type BrainParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'ספר החוקים' }

/**
 * The tool's front door, and the only screen a staff member ever sees.
 *
 * This used to be a hub: four cards routing to four screens, above a list of
 * marketing copy from the brand manifest. The bottom nav already reaches this
 * tool, so that hub cost two taps before any task began and spent its largest
 * element on text that was never content.
 *
 * No role gate. rules_select_member_approved admits every member of the tenant
 * to the approved rules -- the first widening of that boundary since accounts
 * replaced the shared access code -- and gating here would put the knowledge
 * behind the role that least needs to read it. The role is handed down instead,
 * because an owner's extra controls are options on this one list rather than a
 * second copy of it.
 *
 * Nothing leaks past RLS either: pending rows, documents and the role catalogue
 * are all owner-only in the database, so this page can only render what the
 * policies already agreed to hand over.
 */
export default async function BrainPage({ params }: BrainParams) {
  const { brandId } = await params
  const { session } = await requireBrand(brandId)

  return <BookClient role={session.role} />
}
