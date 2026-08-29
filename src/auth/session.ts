export type TenantRole = 'owner' | 'staff'

export type SessionBrand = {
  tenantId: string
  role: TenantRole
  brandId: string
}

type Row = Record<string, unknown>

/**
 * Mirrors PostgREST's actual builder chain rather than flattening it: `from()`
 * returns a table builder that only offers `select()`, and the filters live on
 * what `select()` returns. Collapsing the two into one type compiles against a
 * hand-written mock and then fails against the real client.
 */
type FilterBuilder = {
  eq: (column: string, value: unknown) => FilterBuilder
  maybeSingle: () => PromiseLike<{ data: Row | null }>
}

type TableBuilder = {
  select: (columns: string) => FilterBuilder
}

/**
 * The shape both real and mocked clients satisfy. Narrower than SupabaseClient
 * on purpose: this module needs exactly two reads and one auth call, and
 * depending on more than that would make it untestable without a live project.
 */
export type SessionClient = {
  auth: { getUser: () => PromiseLike<{ data: { user: { id: string } | null } }> }
  from: (table: string) => TableBuilder
}

/**
 * Resolve who the caller is and which brand their tenant owns.
 *
 * Uses getUser(), never getSession(). getSession() decodes the cookie the
 * browser sent and therefore trusts data the client controls; getUser()
 * revalidates against the Supabase auth server. On an authorization check that
 * difference is the entire point.
 *
 * Row-level security scopes both reads to the caller, so `profiles` needs no
 * explicit filter: the caller can only see their own row.
 */
export async function loadSessionBrand(client: SessionClient): Promise<SessionBrand | null> {
  const { data: userData } = await client.auth.getUser()
  if (!userData.user) return null

  const { data: profile } = await client.from('profiles').select('tenant_id, role').maybeSingle()
  if (!profile) return null

  const tenantId = profile.tenant_id
  const role = profile.role
  if (typeof tenantId !== 'string') return null
  if (role !== 'owner' && role !== 'staff') return null

  const { data: tenant } = await client
    .from('tenants')
    .select('brand_id')
    .eq('id', tenantId)
    .maybeSingle()
  if (!tenant) return null

  const brandId = tenant.brand_id
  if (typeof brandId !== 'string') return null

  return { tenantId, role, brandId }
}

/**
 * Narrow a full Supabase client to the slice this module uses.
 *
 * The shapes genuinely match, but Supabase's generated types are deep enough
 * that structurally comparing the whole client against SessionClient trips
 * TS2589 ("type instantiation is excessively deep"). The assertion lives here,
 * once and named, rather than as a cast scattered across call sites.
 */
export function asSessionClient(client: unknown): SessionClient {
  return client as SessionClient
}
