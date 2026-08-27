import { RulesApiError } from './rules-api'
import type { Person, TenantRole } from './types'

/**
 * display_name and job_role_id are the only two columns anyone edits here, and
 * the only two an owner holds a grant on. role is selected because the list has
 * to distinguish an owner from staff; tenant_id is deliberately absent, since it
 * is never written from this surface and the policies already scope the read.
 */
const PERSON_COLUMNS = 'id,display_name,role,job_role_id'

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

type PostgrestError = { code?: string | null }
type PersonRow = { id: string; display_name: string | null; role: TenantRole; job_role_id: string | null }

const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
const failed = (status: number) => new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')

const mapError = (error: PostgrestError, status: number | undefined) => (
  error.code === POSTGREST_JWT_EXPIRED || status === 401 ? unauthorized() : failed(status ?? 500)
)

/**
 * Mirrors normalizeRoleName, and for the same reason: two people entered as
 * "מאי  אורנשטיין" and "מאי אורנשטיין" are one person who looks like two in
 * every list they appear in.
 */
export function normalizePersonName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

type Result<T> = { data: T | null; error: PostgrestError | null; status?: number }

type PersonQuery = {
  select: (columns: string) => PersonQuery
  order: (column: string, options?: { nullsFirst?: boolean }) => PersonQuery
  eq: (column: string, value: unknown) => PersonQuery
  update: (values: Record<string, unknown>) => PersonQuery
  maybeSingle: () => PromiseLike<Result<PersonRow>>
} & PromiseLike<Result<PersonRow[]>>

/** Narrower than SupabaseClient: this module reads and writes one table. */
export type PeopleClient = { from: (table: string) => PersonQuery }

const asPerson = (row: PersonRow): Person => ({
  id: row.id,
  // Null is the normal state for every profile that predates display_name. It
  // stays null rather than being defaulted here: the fallback is a rendering
  // decision, and it belongs at the point of rendering.
  displayName: row.display_name,
  role: row.role,
  jobRoleId: row.job_role_id,
})

export function createPeopleApi(client: PeopleClient) {
  return {
    /**
     * Every person in the tenant. Returns just this caller's own row for a staff
     * member and the whole tenant for an owner: profiles_select_self and
     * profiles_select_tenant_owner decide which, so there is no role branch here
     * to get out of step with the policies.
     */
    async listPeople(): Promise<Person[]> {
      const { data, error, status } = await client
        .from('profiles').select(PERSON_COLUMNS).order('display_name', { nullsFirst: false })
      if (error) throw mapError(error, status)
      return (data ?? []).map(asPerson)
    },

    /**
     * Owner only, enforced by profiles_update_job_role_owner. Both columns go
     * through one call because they are edited on one row of one screen, and
     * splitting them would mean two round trips to name someone and say what
     * they do.
     */
    async updatePerson({ personId, displayName, jobRoleId }: {
      personId: string
      displayName: string
      jobRoleId: string
    }): Promise<Person> {
      const normalized = normalizePersonName(displayName)

      const { data, error, status } = await client
        .from('profiles')
        .update({
          // Empty back to null, so clearing a name is expressible. '' would fail
          // the column's length check rather than clear the field.
          display_name: normalized || null,
          // '' is what an unselected <option> carries; the column is a uuid.
          job_role_id: jobRoleId || null,
        })
        .eq('id', personId)
        .select(PERSON_COLUMNS)
        .maybeSingle()

      if (error) throw mapError(error, status)
      // RLS filtering an update to zero rows is a real outcome -- a staff
      // caller, a person moved out of the tenant -- not an auth failure, and it
      // must not hand the caller a person with no fields.
      if (!data) throw failed(404)
      return asPerson(data)
    },
  }
}

export type PeopleApi = ReturnType<typeof createPeopleApi>
