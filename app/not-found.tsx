'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { BrandNotFound } from '../src/components/BrandNotFound'
import { DEFAULT_BRAND_ID, getBrand } from '../src/core/brand-registry'
import { brandHref } from '../src/core/hrefs'

/**
 * A layout cannot set a status code, so an unknown brand reaches here through
 * notFound() and the requested id is recovered from the URL.
 *
 * Next prerenders this page under its own internal route name, where the path
 * reads as "/_not-found", so the request path is only trustworthy once mounted.
 * Naming a brand before then would print that internal name to the reader.
 */
export default function NotFound() {
  const pathname = usePathname()
  const [hasMounted, setHasMounted] = useState(false)

  useEffect(() => {
    setHasMounted(true)
  }, [])

  // A 404 whose first segment names a brand that does exist is about the
  // subject, group or tool beneath it, so only an unconfigured first segment
  // names a missing brand.
  const requestedBrandId = pathname.split('/').filter(Boolean)[0]
  if (hasMounted && requestedBrandId !== undefined && getBrand(requestedBrandId) === undefined) {
    return <BrandNotFound brandId={requestedBrandId} />
  }

  return (
    <main className="brand-not-found">
      <div className="brand-not-found__card">
        <h1>Page not found</h1>
        <p>There is nothing at this address.</p>
        <a href={brandHref(DEFAULT_BRAND_ID)}>Go to the default brand</a>
      </div>
    </main>
  )
}
