import { notFound, redirect } from 'next/navigation'
import { getBrand } from '../core/brand-registry'
import type { BrandManifest } from '../core/brand-types'
import { LOGIN_PATH } from './paths'
import { asSessionClient, loadSessionBrand, type SessionBrand } from './session'
import { createServerSupabase } from './supabase-server'

export type ResolvedBrand = { brand: BrandManifest; session: SessionBrand }

/**
 * The middleware has already redirected an anonymous caller with a `next`
 * parameter, so reaching this branch means the middleware was bypassed or its
 * matcher missed this route. A bare /login is the right destination: there is no
 * request URL to preserve here, and defence in depth does not need to be pretty.
 */
async function resolveSession(): Promise<ResolvedBrand> {
  const session = await loadSessionBrand(asSessionClient(await createServerSupabase()))
  if (!session) redirect(LOGIN_PATH)

  const brand = getBrand(session.brandId)
  if (!brand) {
    // Data and code disagree: a tenant names a brand this deployment does not
    // ship. That is a misconfiguration an operator must see, not a 404, which
    // would tell the user their content does not exist when in fact it is
    // unreachable.
    throw new Error(
      `Tenant ${session.tenantId} names brand "${session.brandId}", which is not in the registry.`,
    )
  }

  return { session, brand }
}

/**
 * Verify the brand named in the URL is the one the caller's tenant owns.
 *
 * A brand belonging to someone else answers 404 rather than 403. A 403 would
 * confirm which brands exist, letting anyone enumerate tenants by probing.
 */
export async function requireBrand(brandId: string): Promise<ResolvedBrand> {
  const resolved = await resolveSession()
  if (resolved.brand.id !== brandId) notFound()
  return resolved
}

/** Answer "which brand is mine", for routes with no brand in the URL. */
export async function resolveUserBrand(): Promise<ResolvedBrand> {
  return resolveSession()
}

export { LOGIN_PATH } from './paths'
