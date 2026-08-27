import { RulesApiError } from './rules-api'
import type { Role } from './types'

const ROLE_COLUMNS = 'id,name,sort_order'

/** Postgres' unique_violation, which roles_tenant_name_unique raises. */
const UNIQUE_VIOLATION = '23505'

/**
 * Past the seeded roles, which sort at 10 and 20, so a role someone adds lands
 * at the end of the list rather than jumping above the two that were there
 * first.
 */
const DEFAULT_SORT_ORDER = 100

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

type PostgrestError = { code?: string | null }
type RoleRow = { id: string; name: string; sort_order: number }

const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
const failed = (status: number) => new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')
const duplicate = () => new RulesApiError('DUPLICATE_ROLE', 409, 'כבר קיים תפקיד בשם הזה')
const emptyName = () => new RulesApiError('EMPTY_NAME', 400, 'נא להזין שם תפקיד')

/**
 * Its own mapper rather than one shared with rules-api, because the two tables
 * fail differently: roles carries a unique constraint a person can trip by
 * typing the same role name twice, and rules has nothing of the kind. Folding
 * the branches together would eventually put a role message in front of a rules
 * failure.
 *
 * The error CLASS is shared, deliberately: useApiErrorHandler recognises
 * RulesApiError, and a fourth class would have to be added there before an
 * expired session on this surface sent anyone back to sign in.
 */
const mapError = (error: PostgrestError, status: number | undefined) => {
  if (error.code === UNIQUE_VIOLATION) return duplicate()
  if (error.code === POSTGREST_JWT_EXPIRED || status === 401) return unauthorized()
  return failed(status ?? 500)
}

/**
 * The normalizer roles_tenant_name_unique's own comment points at. Interior runs
 * of whitespace collapse to one space, so "מנהל  חנות" and "מנהל חנות" are the
 * same name rather than two rows that look identical in every list they appear
 * in. NFKC first: the same visually-identical-but-differently-encoded problem
 * applies to a name typed on a phone keyboard.
 */
export function normalizeRoleName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

type Result<T> = { data: T | null; error: PostgrestError | null; status?: number }

type RoleQuery = {
  select: (columns: string) => RoleQuery
  order: (column: string) => RoleQuery
  eq: (column: string, value: unknown) => RoleQuery
  in: (column: string, values: readonly unknown[]) => RoleQuery
  insert: (values: unknown) => RoleQuery
  update: (values: Record<string, unknown>) => RoleQuery
  delete: () => RoleQuery
  maybeSingle: <T>() => PromiseLike<Result<T>>
} & PromiseLike<Result<RoleRow[] & RuleRoleRow[]>>

type RuleRoleRow = { rule_id: string; role_id: string }

/** Narrower than SupabaseClient: this module touches three tables. */
export type RolesClient = { from: (table: string) => RoleQuery }

const asRole = (row: RoleRow): Role => ({ id: row.id, name: row.name, sortOrder: row.sort_order })

export function createRolesApi(client: RolesClient) {
  return {
    /**
     * The job roles this business has. Ordered by sort_order then name, matching
     * roles_tenant_sort_idx, so the catalogue reads the same in the do/don't
     * filter, in the admin manager, and beside a rule.
     *
     * roles_select_member scopes this to the caller's tenant, so there is no
     * tenant argument to get wrong. Every member reads it: a staff member
     * opening their own do/don't list needs to know which roles exist.
     */
    async listRoles(): Promise<Role[]> {
      const { data, error, status } = await client
        .from('roles').select(ROLE_COLUMNS).order('sort_order').order('name')
      if (error) throw mapError(error, status)
      return (data ?? []).map(asRole)
    },

    /**
     * public.roles is per-tenant and unconstrained by any check constraint
     * precisely so this can exist: the two seeded roles are what one business
     * asked for, and the next one has assistant managers and stockroom staff.
     */
    async createRole({ name, sortOrder = DEFAULT_SORT_ORDER }: { name: string; sortOrder?: number }): Promise<Role> {
      const normalized = normalizeRoleName(name)
      if (!normalized) throw emptyName()

      // roles.tenant_id has no default, and roles_write_owner's with-check
      // requires it to equal current_tenant_id(), so it has to be sent and the
      // only honest source for it is the caller's own profile row. One extra
      // round trip, on a call that happens when someone types a new role name.
      const { data: profile, error: profileError, status: profileStatus } = await client
        .from('profiles').select('tenant_id').maybeSingle<{ tenant_id: string }>()
      if (profileError) throw mapError(profileError, profileStatus)
      if (!profile) throw failed(403)

      const { data, error, status } = await client
        .from('roles').insert({ tenant_id: profile.tenant_id, name: normalized, sort_order: sortOrder })
        .select(ROLE_COLUMNS).maybeSingle<RoleRow>()
      if (error) throw mapError(error, status)
      if (!data) throw failed(403)
      return asRole(data)
    },

    async renameRole({ roleId, name }: { roleId: string; name: string }): Promise<Role> {
      const normalized = normalizeRoleName(name)
      if (!normalized) throw emptyName()

      const { data, error, status } = await client
        .from('roles').update({ name: normalized }).eq('id', roleId).select(ROLE_COLUMNS).maybeSingle<RoleRow>()
      if (error) throw mapError(error, status)
      // RLS filtering an update to zero rows is a real outcome, not an auth
      // failure, and must not hand the caller a role with no fields.
      if (!data) throw failed(404)
      return asRole(data)
    },

    /**
     * Deleting a role cascades to rule_roles, so the rules it addressed revert
     * to addressing everyone rather than disappearing. That is the right
     * default -- knowledge outlives an org chart -- and it is why this is a
     * delete rather than a soft-delete flag.
     */
    async deleteRole({ roleId }: { roleId: string }): Promise<void> {
      const { error, status } = await client.from('roles').delete().eq('id', roleId)
      if (error) throw mapError(error, status)
    },

    /**
     * Which roles a set of rules address, as a map from rule id to role ids. A
     * rule absent from the map addresses everyone: that is the "no rows" default
     * the join table encodes, and callers must treat a missing key and an empty
     * array the same way.
     */
    async listRuleRoles({ ruleIds }: { ruleIds: readonly string[] }): Promise<Map<string, string[]>> {
      if (!ruleIds.length) return new Map()

      const { data, error, status } = await client
        .from('rule_roles').select('rule_id,role_id').in('rule_id', ruleIds)
      if (error) throw mapError(error, status)

      const byRule = new Map<string, string[]>()
      for (const row of (data ?? []) as RuleRoleRow[]) {
        const existing = byRule.get(row.rule_id)
        if (existing) existing.push(row.role_id)
        else byRule.set(row.rule_id, [row.role_id])
      }
      return byRule
    },

    /**
     * Replace, not merge. The editor shows every role with the current ones
     * checked, so what it sends IS the intended final state; an additive call
     * could never uncheck one.
     *
     * Delete-then-insert in two statements, which is not atomic: a failure
     * between them leaves the rule addressing everyone. That is the safe
     * direction to fail in -- over-broad, visible, and re-fixable from the same
     * screen -- rather than inserting first and stranding duplicates the primary
     * key would reject anyway. Making it atomic needs an RPC, which is the right
     * fix the day this runs anywhere but a reviewer's own edit sheet.
     */
    async setRuleRoles({ ruleId, roleIds }: { ruleId: string; roleIds: readonly string[] }): Promise<string[]> {
      const { error: deleteError, status: deleteStatus } = await client
        .from('rule_roles').delete().eq('rule_id', ruleId)
      if (deleteError) throw mapError(deleteError, deleteStatus)

      if (!roleIds.length) return []

      const { data, error, status } = await client
        .from('rule_roles')
        .insert(roleIds.map((id) => ({ rule_id: ruleId, role_id: id })))
        .select('role_id')
      if (error) throw mapError(error, status)
      return ((data ?? []) as { role_id: string }[]).map((row) => row.role_id)
    },
  }
}

export type RolesApi = ReturnType<typeof createRolesApi>
