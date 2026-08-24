import { describe, expect, it, vi } from 'vitest'
import { createRulesApi, RulesApiError, type RulesClient } from '../../src/brain/rules-api'
import type { Rule } from '../../src/brain/types'

const RULE: Rule = {
  id: 'rule-1',
  topic_id: 'store',
  text: 'לחייך',
  is_starred: false,
  created_at: '2026-08-20T10:00:00Z',
  kind: 'tip',
  status: 'pending',
  source: 'pdf',
}

type Outcome = { data?: unknown; error?: { code?: string } | null; status?: number }

function client(outcomes: {
  rpc?: Outcome
  update?: Outcome
  invoke?: { data?: unknown; error?: { context?: { status?: number } } | null }
} = {}) {
  const rpcArgs: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []

  const rpcResult = outcomes.rpc ?? { data: [RULE], error: null }
  const updateResult = outcomes.update ?? { data: RULE, error: null }

  const supabase = {
    functions: {
      invoke: vi.fn(async () => outcomes.invoke ?? { data: { ok: true }, error: null }),
    },
    rpc: vi.fn((_name: string, args?: Record<string, unknown>) => {
      rpcArgs.push(args ?? {})
      return {
        select: async () => rpcResult,
        single: async () => rpcResult,
      }
    }),
    from: vi.fn(() => ({
      update: (values: Record<string, unknown>) => {
        updates.push(values)
        const filter = {
          eq: () => filter,
          select: () => filter,
          maybeSingle: async () => updateResult,
        }
        return filter
      },
    })),
  } as unknown as RulesClient

  return { api: createRulesApi(supabase), rpcArgs, updates, supabase }
}

describe('cursor arguments', () => {
  it('sends neither cursor field when there is no cursor', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: null })

    expect(rpcArgs[0]).toMatchObject({ p_cursor_created_at: null, p_cursor_id: null })
  })

  it('sends both cursor fields together', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: null, cursor: { created_at: 'T', id: 'X' } })

    expect(rpcArgs[0]).toMatchObject({ p_cursor_created_at: 'T', p_cursor_id: 'X' })
  })

  it('sends neither when a cursor is malformed, never one without the other', async () => {
    const { api, rpcArgs } = client()
    // list_rules coalesces a missing field to a sentinel rather than skipping
    // the filter, so half a cursor applies a real, wrong filter.
    await api.listRules({ topicId: null, cursor: { created_at: 'T' } as never })

    expect(rpcArgs[0]).toMatchObject({ p_cursor_created_at: null, p_cursor_id: null })
  })
})

describe('expired sessions', () => {
  it('maps PostgREST PGRST301 to UNAUTHORIZED', async () => {
    const { api } = client({ rpc: { data: null, error: { code: 'PGRST301' }, status: 200 } })

    await expect(api.listRules({ topicId: null })).rejects.toMatchObject({ code: 'UNAUTHORIZED', status: 401 })
  })

  it('maps a bare HTTP 401 to UNAUTHORIZED even without the PostgREST code', async () => {
    const { api } = client({ rpc: { data: null, error: { code: 'SOMETHING' }, status: 401 } })

    await expect(api.listRules({ topicId: null })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('keeps a non-auth failure on its real status rather than a fabricated 500', async () => {
    const { api } = client({ rpc: { data: null, error: { code: 'PGRST116' }, status: 409 } })

    await expect(api.listRules({ topicId: null })).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 409 })
  })

  it('maps a 401 from an edge function invocation too', async () => {
    const { api } = client({ invoke: { error: { context: { status: 401 } } } })

    await expect(api.generateTips({ topicId: 'store' })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('updates filtered to zero rows', () => {
  it('throws rather than returning a row with no fields when RLS hides it', async () => {
    const { api } = client({ update: { data: null, error: null } })

    // { data: null, error: null } means "no row matched", not "cleared". The UI
    // would read properties off the result, so this must throw, and it is not
    // an auth failure.
    await expect(api.setStar({ tipId: 'rule-1', isStarred: true }))
      .rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 404 })
  })

  it('applies the same rule to an approval', async () => {
    const { api } = client({ update: { data: null, error: null } })
    await expect(api.approveRule('rule-1')).rejects.toBeInstanceOf(RulesApiError)
  })
})

describe('what an update is allowed to write', () => {
  it('writes status alone when approving', async () => {
    const { api, updates } = client()
    await api.approveRule('rule-1')

    expect(updates[0]).toEqual({ status: 'approved' })
  })

  it('keeps a rejected rule rather than deleting it', async () => {
    const { api, updates } = client()
    await api.rejectRule('rule-1')

    // The row must survive so the freshness window keeps seeing its
    // normalized_text and never regenerates the same rule forever.
    expect(updates[0]).toEqual({ status: 'rejected' })
  })

  it('never sends normalized_text or status when editing', async () => {
    const { api, updates } = client()
    await api.updateRule({ ruleId: 'rule-1', text: 'חדש', kind: 'process', topicId: 'live' })

    // normalized_text carries no grant and a trigger derives it, so sending it
    // fails the whole update at 42501. status is omitted because editing is not
    // a review decision: a pending rule stays pending after a correction.
    expect(updates[0]).toEqual({ text: 'חדש', kind: 'process', topic_id: 'live' })
    expect(updates[0]).not.toHaveProperty('normalized_text')
    expect(updates[0]).not.toHaveProperty('status')
  })
})

describe('listing defaults', () => {
  it('defaults status to approved so the history keeps its existing meaning', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: 'store' })

    expect(rpcArgs[0]).toMatchObject({ p_status: 'approved', p_topic_id: 'store' })
  })

  it('lets the lobby ask for pending instead', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: null, status: 'pending' })

    expect(rpcArgs[0]).toMatchObject({ p_status: 'pending', p_topic_id: null })
  })

  it('offers a next cursor only when the page came back full', async () => {
    const full = client({ rpc: { data: [RULE], error: null } })
    const page = await full.api.listRules({ topicId: null, limit: 1 })
    expect(page.nextCursor).toEqual({ created_at: RULE.created_at, id: RULE.id })

    const partial = client({ rpc: { data: [RULE], error: null } })
    const shortPage = await partial.api.listRules({ topicId: null, limit: 50 })
    expect(shortPage.nextCursor).toBeNull()
  })
})

describe('kpis', () => {
  it('converts bigint strings to numbers', async () => {
    const { api } = client({
      rpc: {
        data: { knowledge_items: '120', quality_items: '30', previous_items: '10', recent_items: '15' },
        error: null,
      },
    })

    await expect(api.loadKpis()).resolves.toEqual({
      knowledgeItems: 120,
      qualityItems: 30,
      growthPercent: 50,
    })
  })

  it('reports null growth with no prior baseline, never zero or Infinity', async () => {
    const { api } = client({
      rpc: {
        data: { knowledge_items: '5', quality_items: '1', previous_items: '0', recent_items: '5' },
        error: null,
      },
    })

    // A tenant in its first fortnight is the normal case, not an edge case. Zero
    // would falsely claim flat growth and Infinity is unrenderable; the cards
    // render null as "חדש".
    await expect(api.loadKpis()).resolves.toMatchObject({ growthPercent: null })
  })
})
