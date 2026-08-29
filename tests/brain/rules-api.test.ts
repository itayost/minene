import { describe, expect, it, vi } from 'vitest'
import { createRulesApi, RulesApiError, type RulesClient } from '../../src/brain/rules-api'
import { makeRule } from '../fixtures/rule'

const RULE = makeRule()

type Outcome = { data?: unknown; error?: { code?: string } | null; status?: number }

/**
 * The fake stands in for four shapes postgrest-js offers off one call: a
 * thenable (listRuleSubTopics and clearRuleVote await the rpc directly), and
 * .select / .single / .maybeSingle. Modelling only the ones already in use
 * would make a new method look broken for the wrong reason.
 */
function client(
  outcomes: {
    rpc?: Outcome
    update?: Outcome
    select?: Outcome
    invoke?: { data?: unknown; error?: { context?: { status?: number } } | null }
  } = {},
) {
  const rpcNames: string[] = []
  const rpcArgs: Record<string, unknown>[] = []
  const updates: Record<string, unknown>[] = []
  const columns: string[] = []
  const invoked: { name: string; body: unknown }[] = []

  const rpcResult = outcomes.rpc ?? { data: [RULE], error: null }
  const updateResult = outcomes.update ?? { data: RULE, error: null }
  const selectResult = outcomes.select ?? { data: [], error: null }

  const supabase = {
    functions: {
      invoke: vi.fn(async (name: string, options: { body: unknown }) => {
        invoked.push({ name, body: options.body })
        return outcomes.invoke ?? { data: { ok: true }, error: null }
      }),
    },
    rpc: vi.fn((name: string, args?: Record<string, unknown>) => {
      rpcNames.push(name)
      rpcArgs.push(args ?? {})
      return {
        select: async (selected: string) => {
          columns.push(selected)
          return rpcResult
        },
        single: async () => rpcResult,
        maybeSingle: async () => rpcResult,
        then: (resolve: (value: Outcome) => unknown) => resolve(rpcResult),
      }
    }),
    from: vi.fn((table: string) => ({
      update: (values: Record<string, unknown>) => {
        updates.push(values)
        const filter = {
          eq: () => filter,
          select: (selected: string) => {
            columns.push(selected)
            return filter
          },
          maybeSingle: async () => updateResult,
        }
        return filter
      },
      select: async (selected: string) => {
        columns.push(`${table}:${selected}`)
        return selectResult
      },
    })),
  } as unknown as RulesClient

  return { api: createRulesApi(supabase), rpcNames, rpcArgs, updates, columns, invoked, supabase }
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

    await expect(api.listRules({ topicId: null })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      status: 401,
    })
  })

  it('maps a bare HTTP 401 to UNAUTHORIZED even without the PostgREST code', async () => {
    const { api } = client({ rpc: { data: null, error: { code: 'SOMETHING' }, status: 401 } })

    await expect(api.listRules({ topicId: null })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it('keeps a non-auth failure on its real status rather than a fabricated 500', async () => {
    const { api } = client({ rpc: { data: null, error: { code: 'PGRST116' }, status: 409 } })

    await expect(api.listRules({ topicId: null })).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 409,
    })
  })

  it('maps a 401 from an edge function invocation too', async () => {
    const { api } = client({ invoke: { error: { context: { status: 401 } } } })

    await expect(api.generateTips({ topicId: 'store' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})

describe('updates filtered to zero rows', () => {
  it('throws rather than returning a row with no fields when RLS hides it', async () => {
    const { api } = client({ update: { data: null, error: null } })

    // { data: null, error: null } means "no row matched", not "cleared". The UI
    // would read properties off the result, so this must throw, and it is not
    // an auth failure.
    // This assertion used to ride on setStar, which is gone with the star. It
    // moves rather than disappearing: updateRule writes through the same
    // from().update().eq().select().maybeSingle() shape and fails the same way.
    await expect(
      api.updateRule({ ruleId: 'rule-1', text: 'לחייך', kind: 'tip', topicId: 'store' }),
    ).rejects.toMatchObject({ code: 'REQUEST_FAILED', status: 404 })
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
    expect(updates[0]).toEqual({
      text: 'חדש',
      kind: 'process',
      topic_id: 'live',
      sub_topic: null,
      polarity: null,
      response: null,
    })
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
        data: {
          knowledge_items: '120',
          quality_items: '30',
          previous_items: '10',
          recent_items: '15',
        },
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

describe('the columns a rule is read with', () => {
  it('does not select a column nothing renders', async () => {
    const { api, columns } = client()
    await api.listRules({ topicId: null })

    // is_starred was one owner's unexplained flag on a row that now carries a
    // percentage built from real votes. The column stays in the database --
    // dropping it is a migration in another repo, and it holds live rows --
    // but nothing here reads it.
    expect(columns[0]?.split(',')).not.toContain('is_starred')
  })

  it('selects every column the Rule type declares', async () => {
    const { api, columns } = client()
    await api.listRules({ topicId: null })

    // A field on Rule that is missing from the select list is not a type error
    // anywhere: it is a property that is always undefined at runtime, which the
    // UI renders as a blank cell rather than as a failure.
    const [selected] = columns
    expect(selected?.split(',')).toEqual(expect.arrayContaining(Object.keys(RULE)))
  })
})

describe('the axes a rule is filed under', () => {
  it('leaves the new filters unset when the caller does not ask for them', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: 'store' })

    // null means "no filter" to list_rules, the same convention kind and status
    // already follow, so every existing call site keeps its behaviour untouched.
    expect(rpcArgs[0]).toMatchObject({ p_sub_topic: null, p_polarity: null, p_role_id: null })
  })

  it('filters by polarity and role for a job-specific do list', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: null, polarity: 'do', roleId: 'role-7' })

    expect(rpcArgs[0]).toMatchObject({ p_polarity: 'do', p_role_id: 'role-7' })
  })

  it('filters by sub-topic', async () => {
    const { api, rpcArgs } = client()
    await api.listRules({ topicId: 'store', subTopic: 'קבלת פנים' })

    expect(rpcArgs[0]).toMatchObject({ p_sub_topic: 'קבלת פנים' })
  })
})

describe('correcting a classification', () => {
  it('carries a case rule its response and polarity', async () => {
    const { api, updates } = client()
    await api.updateRule({
      ruleId: 'rule-1',
      text: 'לקוחה מבקשת החזר בלי חשבונית',
      kind: 'case',
      topicId: 'store',
      subTopic: 'החזרות',
      polarity: null,
      response: 'להציע זיכוי',
    })

    expect(updates[0]).toMatchObject({ sub_topic: 'החזרות', response: 'להציע זיכוי', kind: 'case' })
  })
})

describe('hunting for knowledge on the web', () => {
  it('asks the hunt function for a topic and an optional sub-topic', async () => {
    const { api, invoked } = client()
    await api.huntExternal({ topicId: 'store', subTopic: 'חלון ראווה' })

    expect(invoked[0]).toEqual({
      name: 'hunt-external',
      body: { topicId: 'store', subTopic: 'חלון ראווה' },
    })
  })

  it('hunts a whole topic when no sub-topic is named', async () => {
    const { api, invoked } = client()
    await api.huntExternal({ topicId: 'store' })

    expect(invoked[0]?.body).toEqual({ topicId: 'store', subTopic: null })
  })

  it('treats finding nothing new as a success rather than a failure', async () => {
    const { api } = client({ invoke: { data: { inserted: 0 }, error: null } })

    // Everything the hunt found was already inside the freshness window. The
    // caller renders that as a sentence, so it must not arrive as a rejection.
    await expect(api.huntExternal({ topicId: 'store' })).resolves.toEqual({ inserted: 0 })
  })

  it('sends an expired session back to sign in', async () => {
    const { api } = client({ invoke: { error: { context: { status: 401 } } } })

    await expect(api.huntExternal({ topicId: 'store' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})

describe('processes that have been proven to work', () => {
  it('ranks by rating through its own RPC rather than a filter on list_rules', async () => {
    const { api, rpcNames, rpcArgs } = client()
    await api.listProvenProcesses({ minVotes: 5, minLikePct: 70, limit: 10 })

    // Ordering by a percentage cannot share list_rules' (created_at, id) cursor,
    // which is why this is a separate function and not another parameter.
    expect(rpcNames[0]).toBe('list_proven_processes')
    expect(rpcArgs[0]).toEqual({ p_min_votes: 5, p_min_like_pct: 70, p_limit: 10 })
  })

  it('returns a plain list, with no cursor, because a ranking is not a queue', async () => {
    const { api } = client()

    await expect(api.listProvenProcesses()).resolves.toEqual([RULE])
  })

  it('reads as empty when nobody has voted yet', async () => {
    const { api } = client({ rpc: { data: null, error: null } })

    await expect(api.listProvenProcesses()).resolves.toEqual([])
  })
})

describe('the sub-topic catalog', () => {
  it('converts the bigint rule count to a number', async () => {
    const { api } = client({
      rpc: { data: [{ sub_topic: 'החזרות', rule_count: '14' }], error: null },
    })

    // postgrest-js hands bigint back as a string, for the same reason the KPI
    // columns arrive as strings. Rendering it unconverted sorts '9' above '14'.
    await expect(api.listRuleSubTopics()).resolves.toEqual([{ subTopic: 'החזרות', ruleCount: 14 }])
  })

  it('offers an empty catalog rather than failing when nothing is classified', async () => {
    const { api } = client({ rpc: { data: null, error: null } })

    await expect(api.listRuleSubTopics()).resolves.toEqual([])
  })

  it('reads the catalog for one topic at a time when asked', async () => {
    const { api, rpcNames, rpcArgs } = client({ rpc: { data: [], error: null } })
    await api.listRuleSubTopics({ topicId: 'store', status: 'pending' })

    expect(rpcNames[0]).toBe('list_rule_sub_topics')
    expect(rpcArgs[0]).toEqual({ p_topic_id: 'store', p_status: 'pending' })
  })
})

describe('rating a rule', () => {
  it('lets the RPC supply the voter so no caller can get it wrong', async () => {
    const { api, rpcArgs } = client({
      rpc: { data: { rule_id: 'rule-1', is_like: true }, error: null },
    })
    await api.setRuleVote({ ruleId: 'rule-1', isLike: true })

    expect(rpcArgs[0]).toEqual({ p_rule_id: 'rule-1', p_is_like: true })
  })

  it('returns the vote that was actually recorded', async () => {
    const { api } = client({ rpc: { data: { rule_id: 'rule-1', is_like: false }, error: null } })

    await expect(api.setRuleVote({ ruleId: 'rule-1', isLike: false })).resolves.toEqual({
      ruleId: 'rule-1',
      isLike: false,
    })
  })

  it('throws rather than returning a vote with no fields when the rule is hidden', async () => {
    const { api } = client({ rpc: { data: null, error: null } })

    await expect(api.setRuleVote({ ruleId: 'rule-1', isLike: true })).rejects.toMatchObject({
      code: 'REQUEST_FAILED',
      status: 404,
    })
  })

  it('withdraws a vote without expecting a row back', async () => {
    const { api, rpcNames, rpcArgs } = client({ rpc: { data: null, error: null } })

    // Withdrawing is not the same as voting no: a cleared vote leaves the
    // denominator, a dislike stays in it.
    await expect(api.clearRuleVote({ ruleId: 'rule-1' })).resolves.toBeUndefined()
    expect(rpcNames[0]).toBe('clear_rule_vote')
    expect(rpcArgs[0]).toEqual({ p_rule_id: 'rule-1' })
  })

  it('surfaces an expired session while withdrawing', async () => {
    const { api } = client({ rpc: { data: null, error: { code: 'PGRST301' } } })

    await expect(api.clearRuleVote({ ruleId: 'rule-1' })).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    })
  })
})

describe('this person’s own votes', () => {
  it('returns a map so rendering a list is not a scan per row', async () => {
    const { api } = client({
      select: {
        data: [
          { rule_id: 'rule-1', is_like: true },
          { rule_id: 'rule-2', is_like: false },
        ],
        error: null,
      },
    })

    const votes = await api.listMyVotes()

    expect(votes.get('rule-1')).toBe(true)
    expect(votes.get('rule-2')).toBe(false)
    expect(votes.get('rule-3')).toBeUndefined()
  })

  it('asks for nobody else’s, because the policy is the filter', async () => {
    const { api, columns } = client({ select: { data: [], error: null } })
    await api.listMyVotes()

    expect(columns[0]).toBe('rule_votes:rule_id,is_like')
  })
})

describe('knowledge submitted by a person in the tenant', () => {
  it('sends every axis so a submitted case carries its response', async () => {
    const { api, rpcNames, rpcArgs } = client({ rpc: { data: RULE, error: null } })
    await api.submitInternalRule({
      topicId: 'store',
      text: 'לקוחה מבקשת החזר בלי חשבונית',
      kind: 'case',
      subTopic: 'החזרות',
      polarity: null,
      response: 'להציע זיכוי',
    })

    expect(rpcNames[0]).toBe('submit_internal_rule')
    expect(rpcArgs[0]).toEqual({
      p_topic_id: 'store',
      p_text: 'לקוחה מבקשת החזר בלי חשבונית',
      p_kind: 'case',
      p_sub_topic: 'החזרות',
      p_polarity: null,
      p_response: 'להציע זיכוי',
    })
  })

  it('defaults an unclassified submission to a tip', async () => {
    const { api, rpcArgs } = client({ rpc: { data: RULE, error: null } })
    await api.submitInternalRule({ topicId: 'store', text: 'לחייך' })

    expect(rpcArgs[0]).toMatchObject({
      p_kind: 'tip',
      p_sub_topic: null,
      p_polarity: null,
      p_response: null,
    })
  })

  it('returns the saved rule, which is the only way the submitter sees it', async () => {
    const { api } = client({ rpc: { data: RULE, error: null } })

    // rules_select_member_approved admits approved rows only, so a submitter
    // cannot read their own pending row back. This response is the confirmation.
    await expect(api.submitInternalRule({ topicId: 'store', text: 'לחייך' })).resolves.toEqual(RULE)
  })

  it('throws when nothing comes back rather than reporting a phantom save', async () => {
    const { api } = client({ rpc: { data: null, error: null } })

    await expect(api.submitInternalRule({ topicId: 'store', text: 'לחייך' })).rejects.toMatchObject(
      { code: 'REQUEST_FAILED', status: 500 },
    )
  })
})
