import { requireBrand } from '../../../../../src/auth/require-brand'
import { BookClient } from './book-client'

type BookParams = { params: Promise<{ brandId: string }> }

export const metadata = { title: 'ספר החוקים' }

/**
 * The one brain surface with no role gate, and deliberately so.
 *
 * rules_select_member_approved admits every member of the tenant to the approved
 * rules, which is the first widening of that boundary since accounts replaced
 * the shared access code. A staff member reading the approved knowledge, rating
 * it and contributing to it is the point of the whole feature: gating it would
 * put the knowledge behind the role that least needs to read it, and leave the
 * rating aggregate produced entirely by the person who already knows.
 *
 * Nothing here leaks past that policy either. The lobby's pending rows, the
 * documents and the history stay owner-only in the database, so this page can
 * only ever render what RLS already agreed to hand over.
 */
export default async function BookPage({ params }: BookParams) {
  const { brandId } = await params
  await requireBrand(brandId)

  return <BookClient />
}
