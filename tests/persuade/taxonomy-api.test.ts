import { describe, expect, it } from 'vitest'
import { createTaxonomyApi } from '../../src/persuade/taxonomy-api'

/**
 * The seam between the database and everything the screen draws: it maps
 * role_slug to roleSlug, role_order to a number, and so on. A mapping bug
 * here is invisible until the screen renders wrong, and the screen mocks this
 * api wholesale, so nothing downstream would catch it.
 */

type Row = Record<string, unknown>
type Outcome = { data: Row[] | null; error: { message: string } | null }

/**
 * A table-aware fake matching the one surface listRoleNeeds uses: select,
 * then await the builder directly -- the same shape as fakeDb in
 * content.test.ts, scoped to what this reader actually calls.
 */
function fakeDb(outcomes: Record<string, Outcome>) {
  const selects: Record<string, string[]> = {}
  const client = {
    from: (table: string) => ({
      select: (columns: string) => {
        selects[table] ??= []
        selects[table].push(columns)
        const outcome = outcomes[table] ?? { data: [], error: null }
        return { then: (resolve: (v: Outcome) => unknown) => resolve(outcome) }
      },
    }),
  }
  return { client: client as Parameters<typeof createTaxonomyApi>[0], selects }
}

const ROLE_NEED_ROW: Row = {
  industry: 'retail',
  role_slug: 'ceo',
  role_label: 'מנכ"ל',
  role_order: 1,
  need_key: 'profitability',
  need_label: 'רווחיות',
  need_order: 1,
  meta_need: 'control',
}

describe('reading the taxonomy from role_needs', () => {
  it('requests every column NeedRow needs', async () => {
    const { client, selects } = fakeDb({})
    await createTaxonomyApi(client).listRoleNeeds()

    const requested = selects.role_needs?.[0]?.split(',') ?? []
    const needRowFields = [
      'industry',
      'role_slug',
      'role_label',
      'role_order',
      'need_key',
      'need_label',
      'need_order',
      'meta_need',
    ]
    for (const field of needRowFields) {
      expect(requested).toContain(field)
    }
  })

  it('maps snake_case columns to camelCase, field by field', async () => {
    const { client } = fakeDb({ role_needs: { data: [ROLE_NEED_ROW], error: null } })
    const [need] = await createTaxonomyApi(client).listRoleNeeds()

    expect(need).toEqual({
      industry: 'retail',
      roleSlug: 'ceo',
      roleLabel: 'מנכ"ל',
      roleOrder: 1,
      needKey: 'profitability',
      needLabel: 'רווחיות',
      needOrder: 1,
      metaNeed: 'control',
    })
  })

  it('coerces role_order and need_order to numbers even when read back as strings', async () => {
    // The database stores them as ints, but PostgREST can hand back strings.
    // A string sort ("10" < "2") would put a senior role above a junior one
    // and scramble the org chart the screen draws.
    const stringOrders = { ...ROLE_NEED_ROW, role_order: '2', need_order: '3' }
    const { client } = fakeDb({ role_needs: { data: [stringOrders], error: null } })
    const [need] = await createTaxonomyApi(client).listRoleNeeds()

    expect(need?.roleOrder).toBe(2)
    expect(typeof need?.roleOrder).toBe('number')
    expect(need?.needOrder).toBe(3)
    expect(typeof need?.needOrder).toBe('number')
  })

  it('throws with a Hebrew message when the read fails', async () => {
    const { client } = fakeDb({
      role_needs: { data: null, error: { message: 'connection reset' } },
    })

    await expect(createTaxonomyApi(client).listRoleNeeds()).rejects.toThrow(/[֐-׿]/)
  })
})
