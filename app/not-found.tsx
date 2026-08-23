import { brandHref } from '../src/core/hrefs'
import { DEFAULT_BRAND_ID } from '../src/core/brand-registry'

export default function NotFound() {
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
