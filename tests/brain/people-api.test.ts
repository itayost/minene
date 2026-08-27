import { describe, expect, it, vi } from 'vitest'
import { createPeopleApi, normalizePersonName, type PeopleClient } from '../../src/brain/people-api'

type Outcome = { data?: unknown; error?: { code?: string } | null; status?: number }

function client(outcome: Outcome = { data: [], error: null }) {
  const calls: { columns: string; ordered: { column: string; nullsFirst?: boolean }[] } = { columns: '', ordered: [] }
  const updates: Record<string, unknown>[] = []

  const supabase = {
    from: vi.fn(() => {
      const query = {
        select: (columns: string) => { calls.columns = columns; return query },
        order: (column: string, options?: { nullsFirst?: boolean }) => {
          calls.ordered.push({ column, ...options })
          return query
        },
        eq: () => query,
        update: (values: Record<string, unknown>) => { updates.push(values); return query },
        maybeSingle: async () => outcome,
        then: (resolve: (value: Outcome) => unknown) => resolve(outcome),
      }
      return query
    }),
  } as unknown as PeopleClient

  return { api: createPeopleApi(supabase), calls, updates }
}

const ROW = { id: 'person-1', display_name: 'מאי אורנשטיין', role: 'staff', job_role_id: 'role-1' }

describe('naming a person', () => {
  it('collapses interior whitespace, mirroring the role normalizer', () => {
    // Two people entered as "מאי  אורנשטיין" and "מאי אורנשטיין" are one person
    // who looks like two in every list they appear in.
    expect(normalizePersonName('מאי  אורנשטיין')).toBe('מאי אורנשטיין')
  })
})

describe('the people in this tenant', () => {
  it('reads only the columns anyone here edits or renders', async () => {
    const { api, calls } = client()
    await api.listPeople()

    // tenant_id is deliberately absent: it is never written from this surface,
    // and the policies already scope the read.
    expect(calls.columns).toBe('id,display_name,role,job_role_id')
  })

  it('sorts unnamed people last rather than first', async () => {
    const { api, calls } = client()
    await api.listPeople()

    expect(calls.ordered).toEqual([{ column: 'display_name', nullsFirst: false }])
  })

  it('leaves an unnamed person unnamed rather than dressing a uuid up as a name', async () => {
    const { api } = client({ data: [{ ...ROW, display_name: null }], error: null })

    // The fallback is a rendering decision, and it belongs at the point of
    // rendering. A uuid shown as a name is worse than an honest blank.
    await expect(api.listPeople()).resolves.toEqual([
      { id: 'person-1', displayName: null, role: 'staff', jobRoleId: 'role-1' },
    ])
  })

  it('does not branch on the caller’s role, because the policies already do', async () => {
    const { api } = client({ data: [ROW], error: null })

    // profiles_select_self and profiles_select_tenant_owner decide whether this
    // returns one row or the whole tenant. A branch here would drift out of step
    // with them.
    await expect(api.listPeople()).resolves.toHaveLength(1)
  })
})

describe('saying who someone is and what they do', () => {
  it('writes the name and the job in one call', async () => {
    const { api, updates } = client({ data: ROW, error: null })
    await api.updatePerson({ personId: 'person-1', displayName: 'מאי  אורנשטיין', jobRoleId: 'role-1' })

    // They are edited on one row of one screen. Splitting them would mean two
    // round trips to name someone and say what they do.
    expect(updates[0]).toEqual({ display_name: 'מאי אורנשטיין', job_role_id: 'role-1' })
  })

  it('clears a name to null rather than to an empty string', async () => {
    const { api, updates } = client({ data: ROW, error: null })
    await api.updatePerson({ personId: 'person-1', displayName: '  ', jobRoleId: 'role-1' })

    // '' would fail the column's length check rather than clear the field.
    expect(updates[0]).toMatchObject({ display_name: null })
  })

  it('turns an unselected job back into no job at all', async () => {
    const { api, updates } = client({ data: ROW, error: null })
    await api.updatePerson({ personId: 'person-1', displayName: 'מאי', jobRoleId: '' })

    // '' is what an unselected <option> carries; the column is a uuid.
    expect(updates[0]).toMatchObject({ job_role_id: null })
  })

  it('throws rather than returning a person with no fields when RLS hides the row', async () => {
    const { api } = client({ data: null, error: null })

    await expect(api.updatePerson({ personId: 'person-1', displayName: 'מאי', jobRoleId: '' }))
      .rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 404 })
  })

  it('sends an expired session back to sign in', async () => {
    const { api } = client({ data: null, error: { code: 'PGRST301' } })

    await expect(api.listPeople()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
