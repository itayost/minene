import { redirect } from 'next/navigation'
import { resolveUserBrand } from '../src/auth/require-brand'
import { brandHref } from '../src/core/hrefs'

export default async function RootPage() {
  const { brand } = await resolveUserBrand()
  redirect(brandHref(brand.id))
}
