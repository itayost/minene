import type { NeedRow } from './taxonomy'

/**
 * role_needs, read from the browser.
 *
 * Safe from here and tenant-free by construction: role_needs is industry-scoped
 * and grants select to authenticated with a policy of `using (true)`. What a
 * branch manager needs is a fact about the job, not about one business, which
 * is the same reason the simulations table is readable across tenants.
 */
interface TaxonomyClient {
  from(table: string): {
    select(columns: string): PromiseLike<{
      data: Record<string, unknown>[] | null
      error: { message: string } | null
    }>
  }
}

const NEED_COLUMNS =
  'industry,role_slug,role_label,role_order,need_key,need_label,need_order,meta_need'

export function createTaxonomyApi(client: TaxonomyClient) {
  return {
    async listRoleNeeds(): Promise<NeedRow[]> {
      const { data, error } = await client.from('role_needs').select(NEED_COLUMNS)
      if (error) throw new Error(`קריאת מפת הצרכים נכשלה: ${error.message}`)

      return (data ?? []).map((row) => ({
        industry: String(row.industry),
        roleSlug: String(row.role_slug),
        roleLabel: String(row.role_label),
        roleOrder: Number(row.role_order),
        needKey: String(row.need_key),
        needLabel: String(row.need_label),
        needOrder: Number(row.need_order),
        metaNeed: String(row.meta_need),
      }))
    },
  }
}

export type TaxonomyApi = ReturnType<typeof createTaxonomyApi>
