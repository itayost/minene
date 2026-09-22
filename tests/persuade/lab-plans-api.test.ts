import { describe, expect, it } from 'vitest'
import { createLabPlansApi } from '../../src/persuade/lab-plans-api'

/**
 * The seam between the database and the screen: it fetches one plan by key
 * and asserts plan_key over the plan's own stored id. Task 9 mocks this api
 * wholesale, so a bug here would be invisible until the screen rendered wrong
 * and no other test in the plan would catch it.
 */

type Row = { plan_key: string; plan: Record<string, unknown> } | null
type Outcome = { data: Row; error: { message: string } | null }

/**
 * A table-aware fake matching the one surface getPlan uses: select, then eq,
 * then maybeSingle -- the same shape as fakeDb in content.test.ts, scoped to
 * what this reader actually calls.
 */
function fakeDb(outcome: Outcome) {
  const selects: string[] = []
  const filters: [string, unknown][] = []
  const client = {
    from: (_table: string) => ({
      select: (columns: string) => {
        selects.push(columns)
        return {
          eq: (column: string, value: unknown) => {
            filters.push([column, value])
            return { maybeSingle: async () => outcome }
          },
        }
      },
    }),
  }
  return { client: client as Parameters<typeof createLabPlansApi>[0], selects, filters }
}

// plan_key and the stored plan's own id deliberately differ, exactly as
// loadPlans is tested (content.test.ts): a fixture where they match would
// prove nothing about the key override below.
const PLAN_ROW = {
  plan_key: 'briefings',
  plan: { id: 'whatever-was-stored', topic: 'תדריכי בוקר', escalation: [] },
}

describe('reading one library plan by key', () => {
  it('requests plan_key and the plan jsonb, nothing else', async () => {
    const { client, selects } = fakeDb({ data: PLAN_ROW, error: null })
    await createLabPlansApi(client).getPlan('briefings')

    expect(selects).toEqual(['plan_key,plan'])
  })

  it('filters by the plan_key it was asked for', async () => {
    const { client, filters } = fakeDb({ data: PLAN_ROW, error: null })
    await createLabPlansApi(client).getPlan('briefings')

    expect(filters).toEqual([['plan_key', 'briefings']])
  })

  it('asserts plan_key over the plan’s own stored id', async () => {
    // The stored plan.id is 'whatever-was-stored' and plan_key is 'briefings'.
    // A getPlan that trusted the stored id instead of the key it was asked
    // for would come back wrong here, and only here.
    const { client } = fakeDb({ data: PLAN_ROW, error: null })
    const plan = await createLabPlansApi(client).getPlan('briefings')

    expect(plan?.id).toBe('briefings')
  })

  it('returns null for a need with no generated plan yet, not a throw', async () => {
    // The taxonomy has 130 needs and generation is a separate pass over it,
    // so a missing row is a real state, not an error.
    const { client } = fakeDb({ data: null, error: null })

    await expect(createLabPlansApi(client).getPlan('nothing')).resolves.toBeNull()
  })

  it('returns null for a row whose plan jsonb is empty, rather than a hollow plan', async () => {
    // Spreading a null jsonb yields `{}`, and a plan with no `arguments` array
    // takes the whole screen down on the first `.map`. A row with nothing in it
    // is the same answer to the reader as no row at all.
    const { client } = fakeDb({
      data: { plan_key: 'gen-retail-ceo-profitability', plan: null } as never,
      error: null,
    })

    await expect(
      createLabPlansApi(client).getPlan('gen-retail-ceo-profitability'),
    ).resolves.toBeNull()
  })

  it('throws with a Hebrew message when the read fails', async () => {
    const { client } = fakeDb({ data: null, error: { message: 'connection reset' } })

    await expect(createLabPlansApi(client).getPlan('briefings')).rejects.toThrow(/[֐-׿]/)
  })
})
