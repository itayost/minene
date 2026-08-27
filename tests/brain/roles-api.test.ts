import { describe, expect, it, vi } from 'vitest'
import { createRolesApi, normalizeRoleName, type RolesClient } from '../../src/brain/roles-api'

type Outcome = { data?: unknown; error?: { code?: string } | null; status?: number }

type Step = { table: string; verb: string; values?: unknown }

/**
 * Records what each call did rather than what it returned, because most of what
 * matters here is the shape of the write: which table, in which order, with
 * which payload.
 */
function client(outcomes: Record<string, Outcome> = {}) {
  const calls: { table: string; columns: string; ordered: string[] } = { table: '', columns: '', ordered: [] }
  const steps: Step[] = []

  const result = (table: string) => outcomes[table] ?? { data: [], error: null }

  const supabase = {
    from: vi.fn((table: string) => {
      calls.table = table
      const query = {
        select: (columns: string) => { calls.columns = columns; return query },
        order: (column: string) => { calls.ordered.push(column); return query },
        eq: () => query,
        in: () => query,
        insert: (values: unknown) => { steps.push({ table, verb: 'insert', values }); return query },
        update: (values: unknown) => { steps.push({ table, verb: 'update', values }); return query },
        delete: () => { steps.push({ table, verb: 'delete' }); return query },
        maybeSingle: async () => result(table),
        then: (resolve: (value: Outcome) => unknown) => resolve(result(table)),
      }
      return query
    }),
  } as unknown as RolesClient

  return { api: createRolesApi(supabase), calls, steps }
}

describe('the job-role catalogue', () => {
  it('reads the roles table, scoped by the policy rather than by an argument', async () => {
    const { api, calls } = client()
    await api.listRoles()

    // roles_select_member already limits this to the caller's tenant, so there
    // is no tenant argument here for a caller to get wrong.
    expect(calls.table).toBe('roles')
    expect(calls.columns).toBe('id,name,sort_order')
  })

  it('orders by sort order and then by name, matching the index', async () => {
    const { api, calls } = client()
    await api.listRoles()

    // The list appears in a filter, in the admin manager and beside a rule. It
    // has to read the same in all three or the same catalogue looks like three.
    expect(calls.ordered).toEqual(['sort_order', 'name'])
  })

  it('hands back a role the UI can read without knowing the column names', async () => {
    const { api } = client({ roles: { data: [{ id: 'role-1', name: 'מנהלת חנות', sort_order: 10 }], error: null } })

    await expect(api.listRoles()).resolves.toEqual([{ id: 'role-1', name: 'מנהלת חנות', sortOrder: 10 }])
  })

  it('reads as an empty catalogue rather than failing when no role exists yet', async () => {
    const { api } = client({ roles: { data: null, error: null } })

    await expect(api.listRoles()).resolves.toEqual([])
  })

  it('sends an expired session back to sign in', async () => {
    const { api } = client({ roles: { data: null, error: { code: 'PGRST301' } } })

    await expect(api.listRoles()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

const ROLE_ROW = { id: 'role-1', name: 'מנהלת חנות', sort_order: 10 }
const PROFILE = { data: { tenant_id: 'tenant-1' }, error: null }

describe('naming a role', () => {
  it('collapses interior whitespace, so one role cannot become two rows', () => {
    // roles_tenant_name_unique is an exact-match constraint, and no index
    // expression collapses interior whitespace. This is the normalizer that
    // constraint's own comment points at.
    expect(normalizeRoleName('מנהל  חנות')).toBe('מנהל חנות')
    expect(normalizeRoleName('  מנהלת  ')).toBe('מנהלת')
  })

  it('refuses an empty name without spending a round trip', async () => {
    const { api, steps } = client()

    await expect(api.createRole({ name: '   ' })).rejects.toMatchObject({ code: 'EMPTY_NAME' })
    expect(steps).toHaveLength(0)
  })

  it('reads the tenant from the caller’s own profile', async () => {
    const { api, steps } = client({ profiles: PROFILE, roles: { data: ROLE_ROW, error: null } })
    await api.createRole({ name: 'מנהלת  חנות' })

    // roles.tenant_id has no default and roles_write_owner's with-check requires
    // it to equal current_tenant_id(), so it has to be sent, and the only honest
    // source for it is the caller's own row.
    expect(steps[0]).toEqual({
      table: 'roles', verb: 'insert', values: { tenant_id: 'tenant-1', name: 'מנהלת חנות', sort_order: 100 },
    })
  })

  it('lands a new role after the seeded ones rather than above them', async () => {
    const { api, steps } = client({ profiles: PROFILE, roles: { data: ROLE_ROW, error: null } })
    await api.createRole({ name: 'מחסנאי' })

    // The seeded roles sort at 10 and 20. Defaulting to 0 would jump every new
    // role above the two that were there first.
    expect(steps[0]?.values).toMatchObject({ sort_order: 100 })
  })

  it('says a duplicate name is a duplicate, which is a thing a person can fix', async () => {
    const { api } = client({ profiles: PROFILE, roles: { data: null, error: { code: '23505' } } })

    await expect(api.createRole({ name: 'מנהלת חנות' })).rejects.toMatchObject({ code: 'DUPLICATE_ROLE' })
  })
})

describe('renaming and removing a role', () => {
  it('normalizes a rename the same way as a creation', async () => {
    const { api, steps } = client({ roles: { data: ROLE_ROW, error: null } })
    await api.renameRole({ roleId: 'role-1', name: 'מנהלת   חנות' })

    expect(steps[0]).toEqual({ table: 'roles', verb: 'update', values: { name: 'מנהלת חנות' } })
  })

  it('throws rather than returning a role with no fields when RLS hides the row', async () => {
    const { api } = client({ roles: { data: null, error: null } })

    await expect(api.renameRole({ roleId: 'role-1', name: 'מנהלת' }))
      .rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 404 })
  })

  it('deletes the role itself and nothing else', async () => {
    const { api, steps } = client()
    await api.deleteRole({ roleId: 'role-1' })

    // The cascade on rule_roles is what makes this safe: rules that addressed
    // the role revert to addressing everyone rather than disappearing.
    // Knowledge outlives an org chart.
    expect(steps).toEqual([{ table: 'roles', verb: 'delete' }])
  })
})

describe('which roles a rule addresses', () => {
  it('groups the join rows by rule', async () => {
    const { api } = client({
      rule_roles: {
        data: [
          { rule_id: 'r1', role_id: 'a' },
          { rule_id: 'r1', role_id: 'b' },
          { rule_id: 'r2', role_id: 'a' },
        ],
        error: null,
      },
    })

    const byRule = await api.listRuleRoles({ ruleIds: ['r1', 'r2'] })

    expect(byRule.get('r1')).toEqual(['a', 'b'])
    expect(byRule.get('r2')).toEqual(['a'])
    // A rule absent from the map addresses everyone: that is the "no rows"
    // default the join table encodes, and a missing key and an empty array mean
    // the same thing.
    expect(byRule.get('r3')).toBeUndefined()
  })

  it('asks nothing at all when there are no rules to ask about', async () => {
    const { api, steps, calls } = client()
    await api.listRuleRoles({ ruleIds: [] })

    expect(steps).toHaveLength(0)
    expect(calls.table).toBe('')
  })

  it('replaces the set rather than adding to it', async () => {
    const { api, steps } = client({ rule_roles: { data: [{ role_id: 'a' }], error: null } })
    await api.setRuleRoles({ ruleId: 'r1', roleIds: ['a'] })

    // The editor shows every role with the current ones checked, so what it
    // sends IS the intended final state. An additive call could never uncheck.
    expect(steps).toEqual([
      { table: 'rule_roles', verb: 'delete' },
      { table: 'rule_roles', verb: 'insert', values: [{ rule_id: 'r1', role_id: 'a' }] },
    ])
  })

  it('clears the set to nothing, which means the rule addresses everyone', async () => {
    const { api, steps } = client()
    await expect(api.setRuleRoles({ ruleId: 'r1', roleIds: [] })).resolves.toEqual([])

    // No insert at all. Failing between the delete and an insert would leave the
    // rule over-broad, which is the safe direction: visible, and re-fixable from
    // the same screen.
    expect(steps).toEqual([{ table: 'rule_roles', verb: 'delete' }])
  })
})
