import { describe, expect, it, vi } from 'vitest'
import { type AssignmentsClient, createAssignmentsApi } from '../../src/persuade/assignments-api'

type Outcome = { data?: unknown; error?: { code?: string } | null; status?: number }

function client(outcomes: Record<string, Outcome> = {}) {
  const calls: { table: string; ordered: string[]; filters: [string, unknown][] } = {
    table: '',
    ordered: [],
    filters: [],
  }
  const rpcArgs: Record<string, unknown>[] = []
  const result = (table: string) => outcomes[table] ?? { data: [], error: null }

  const supabase = {
    from: vi.fn((table: string) => {
      calls.table = table
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          calls.filters.push([col, val])
          return q
        },
        order: (col: string) => {
          calls.ordered.push(col)
          return q
        },
        insert: () => q,
        maybeSingle: async () => result(table),
        then: (resolve: (v: Outcome) => unknown) => resolve(result(table)),
      }
      return q
    }),
    rpc: vi.fn((_name: string, args?: Record<string, unknown>) => {
      rpcArgs.push(args ?? {})
      return {
        maybeSingle: async () => result('rpc'),
        then: (resolve: (v: Outcome) => unknown) => resolve(result('rpc')),
      }
    }),
  } as unknown as AssignmentsClient

  return { api: createAssignmentsApi(supabase), calls, rpcArgs }
}

const ROW = {
  id: 'a1',
  rule_id: 'r1',
  assignee_id: 'p1',
  status: 'open',
  due_on: null,
  created_at: '2026-08-25T09:00:00Z',
  rules: { id: 'r1', text: 'לקיים תדריך של 4 דקות', topic_id: 'briefing', kind: 'process' },
}

describe('what this person still has to do', () => {
  it('asks for open assignments without naming whose', async () => {
    const { api, calls } = client()
    await api.listOpenAssignments()

    // assignments_select_own returns a staff member's own rows and
    // assignments_select_owner returns the tenant's. The policy is the filter,
    // so there is no assignee argument here to get wrong.
    expect(calls.table).toBe('assignments')
    expect(calls.filters).toEqual([['status', 'open']])
  })

  it('orders by what is due first, with undated work last', async () => {
    const { api, calls } = client()
    await api.listOpenAssignments()

    expect(calls.ordered).toEqual(['due_on', 'created_at'])
  })

  it('carries the rule, because the ask IS the rule', async () => {
    const { api } = client({ assignments: { data: [ROW], error: null } })
    const [first] = await api.listOpenAssignments()

    // The ask went through the brain's review gate, which is what makes it
    // photographable -- and the engine refuses to open a conversation without
    // one.
    expect(first?.rule?.text).toBe('לקיים תדריך של 4 דקות')
  })

  it('keeps an assignment whose rule failed to join, rather than dropping it', async () => {
    const { api } = client({ assignments: { data: [{ ...ROW, rules: null }], error: null } })
    const [first] = await api.listOpenAssignments()

    // A task that vanishes from someone's list is worse than one that reads
    // awkwardly.
    expect(first?.id).toBe('a1')
    expect(first?.rule).toBeNull()
  })
})

describe('closing an assignment', () => {
  it('never sends who is reporting', async () => {
    const { api, rpcArgs } = client({ rpc: { data: ROW, error: null } })
    await api.settleAssignment({ assignmentId: 'a1', status: 'done' })

    // settle_assignment derives `source` from who is calling, so a person
    // reporting on themselves cannot be recorded as a manager having observed
    // them. Sending it would hand that distinction to the caller.
    expect(rpcArgs[0]).toEqual({ p_assignment_id: 'a1', p_status: 'done', p_note: null })
  })

  it('throws rather than returning an assignment with no fields', async () => {
    const { api } = client({ rpc: { data: null, error: null } })

    await expect(
      api.settleAssignment({ assignmentId: 'a1', status: 'done' }),
    ).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 404 })
  })
})
