import { redirect } from 'next/navigation'
import { DEFAULT_BRAND_ID } from '../src/core/brand-registry'
import { brandHref } from '../src/core/hrefs'

export default function RootPage() {
  redirect(brandHref(DEFAULT_BRAND_ID))
}
