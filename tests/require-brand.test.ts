import { describe, expect, it, vi } from 'vitest'
import { loadSessionBrand } from '../src/auth/session'

type Row = Record<string, unknown> | null
type User = { id: string } | null

function client({ user, profile, tenant }: { user: User; profile: Row; tenant: Row }) {
  const getUser = vi.fn(async () => ({ data: { user }, error: user ? null : new Error('no user') }))
  const getSession = vi.fn(async () => ({ data: { session: null }, error: null }))

  const from = vi.fn((table: string) => {
    const row = table === 'profiles' ? profile : tenant
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: row, error: null }),
    }
    return builder
  })

  return { auth: { getUser, getSession }, from, getUser, getSession }
}

const USER = { id: 'user-1' }
const PROFILE = { tenant_id: 'tenant-1', role: 'owner' }
const TENANT = { brand_id: 'minene' }

describe('loadSessionBrand', () => {
  it('resolves the brand for a signed-in user', async () => {
    const supabase = client({ user: USER, profile: PROFILE, tenant: TENANT })

    await expect(loadSessionBrand(supabase)).resolves.toEqual({
      tenantId: 'tenant-1',
      role: 'owner',
      brandId: 'minene',
    })
  })

  it('verifies the user against the auth server rather than trusting the cookie', async () => {
    const supabase = client({ user: USER, profile: PROFILE, tenant: TENANT })

    await loadSessionBrand(supabase)

    expect(supabase.getUser).toHaveBeenCalled()
    expect(supabase.getSession).not.toHaveBeenCalled()
  })

  it('returns null when there is no user', async () => {
    const supabase = client({ user: null, profile: PROFILE, tenant: TENANT })
    await expect(loadSessionBrand(supabase)).resolves.toBeNull()
  })

  it('returns null when the user has no profile', async () => {
    const supabase = client({ user: USER, profile: null, tenant: TENANT })
    await expect(loadSessionBrand(supabase)).resolves.toBeNull()
  })

  it('returns null when the profile points at a missing tenant', async () => {
    const supabase = client({ user: USER, profile: PROFILE, tenant: null })
    await expect(loadSessionBrand(supabase)).resolves.toBeNull()
  })
})
