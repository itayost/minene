import type { Rule, RuleCursor, RuleKind, RulePage, RuleStatus, TenantKpis } from './types'

const PAGE_SIZE = 50

/**
 * status and source are selected because the approval lobby needs both: a
 * pending rule's review state, and where it came from (a generated batch or a
 * PDF extraction).
 */
const RULE_COLUMNS = 'id,topic_id,text,is_starred,created_at,kind,status,source'

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

export type RulesApiCode = 'UNAUTHORIZED' | 'REQUEST_FAILED'

export class RulesApiError extends Error {
  readonly code: RulesApiCode
  readonly status: number

  constructor(code: RulesApiCode, status: number, message: string) {
    super(message)
    this.name = 'RulesApiError'
    this.code = code
    this.status = status
  }
}

const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
const failed = (status: number) => new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')

type PostgrestError = { code?: string | null }
type PostgrestResult<T> = { data: T | null; error: PostgrestError | null; status?: number }

/**
 * A JWT that expired mid-session must surface UNAUTHORIZED, which the callers
 * branch on to send the reader back to sign in. Collapsing it into the generic
 * failure bucket would strand them on a silently broken page.
 *
 * PGRST301 is PostgREST's own signal, but it is not exhaustive: any other auth
 * rejection still arrives as a real HTTP 401, so the status is checked too.
 * Non-auth failures keep their real status rather than being rewritten to a
 * fabricated 500.
 */
const mapPostgrestError = (error: PostgrestError, status: number | undefined) => (
  error.code === POSTGREST_JWT_EXPIRED || status === 401 ? unauthorized() : failed(status ?? 500)
)

/**
 * A cursor is only valid when BOTH fields are present. list_rules coalesces a
 * missing p_cursor_created_at to 'infinity' and a missing p_cursor_id to the
 * all-Fs uuid so the (created_at, id) row comparison always applies; it does not
 * special-case "no cursor" as a skipped filter. Sending one field without the
 * other therefore applies a real, wrong filter instead of disabling pagination.
 * Deriving both from one check makes it structurally impossible to send one
 * without the other, even for a malformed cursor.
 */
const cursorArgs = (cursor: RuleCursor | null) => {
  const hasCursor = cursor?.created_at != null && cursor?.id != null
  return {
    p_cursor_created_at: hasCursor ? cursor.created_at : null,
    p_cursor_id: hasCursor ? cursor.id : null,
  }
}

type RuleFilter = {
  eq: (column: string, value: unknown) => RuleFilter
  select: (columns: string) => RuleFilter
  maybeSingle: () => PromiseLike<PostgrestResult<Rule>>
}

type KpiRow = {
  knowledge_items: string | number
  quality_items: string | number
  previous_items: string | number
  recent_items: string | number
}

/**
 * Narrower than SupabaseClient on purpose. This module needs one function
 * invocation, two RPCs and one table, and depending on more than that would
 * make it untestable without a live project. Supabase's generated types are
 * also deep enough that structurally comparing the whole client trips TS2589.
 */
export type RulesClient = {
  functions: {
    invoke: (name: string, options: { body: unknown }) => PromiseLike<{
      data: unknown
      error: { context?: { status?: number } } | null
    }>
  }
  rpc: (name: string, args?: Record<string, unknown>) => {
    select: (columns: string) => PromiseLike<PostgrestResult<Rule[]>>
    single: () => PromiseLike<PostgrestResult<KpiRow>>
  }
  from: (table: string) => { update: (values: Record<string, unknown>) => RuleFilter }
}

/**
 * Shared by approveRule and rejectRule: both move a rule through the review
 * lifecycle by writing `status` alone. The database grants update on specific
 * columns rather than the whole row, and normalized_text is deliberately never
 * among them: it is the dedupe key, a trigger derives it from `text`, and
 * sending it would fail the whole update at 42501.
 */
async function updateStatus(client: RulesClient, ruleId: string, status: RuleStatus): Promise<Rule> {
  const { data, error, status: httpStatus } = await client
    .from('rules').update({ status }).eq('id', ruleId).select(RULE_COLUMNS).maybeSingle()
  if (error) throw mapPostgrestError(error, httpStatus)
  // RLS filtering an update to zero visible rows returns { data: null, error:
  // null }. That is a real outcome -- the row stopped being visible mid-session
  // -- not an auth failure, and it must not hand the caller a row with no
  // fields for the UI to read properties off.
  if (!data) throw failed(404)
  return data
}

function pageFrom(rows: Rule[], limit: number): RulePage {
  const last = rows[rows.length - 1]
  return {
    rows,
    nextCursor: rows.length === limit && last ? { created_at: last.created_at, id: last.id } : null,
  }
}

export type ListRulesOptions = {
  topicId: string | null
  query?: string
  starredOnly?: boolean
  kind?: RuleKind | null
  status?: RuleStatus | null
  cursor?: RuleCursor | null
  limit?: number
}

export function createRulesApi(client: RulesClient) {
  return {
    async generateTips({ topicId }: { topicId: string }): Promise<unknown> {
      // No access-code header: supabase-js attaches the signed-in session's
      // bearer token to function invocations automatically.
      const { data, error } = await client.functions.invoke('generate-tips', { body: { topicId } })
      if (!error) return data
      const status = error.context?.status ?? 500
      throw status === 401 ? unauthorized() : failed(status)
    },

    /**
     * status defaults to 'approved', not null, mirroring list_rules' own
     * default so the admin history keeps seeing what it sees today. The lobby
     * overrides it with 'pending'.
     *
     * topicId is required but may be null, which list_rules reads as "every
     * topic". It has no default precisely because it must stay a decision every
     * caller makes: defaulting it would turn a caller that forgot to pass one
     * into a silent tenant-wide read rather than an obvious mistake.
     */
    async listRules({
      topicId,
      query = '',
      starredOnly = false,
      kind = null,
      status = 'approved',
      cursor = null,
      limit = PAGE_SIZE,
    }: ListRulesOptions): Promise<RulePage> {
      const { data, error, status: httpStatus } = await client.rpc('list_rules', {
        p_topic_id: topicId,
        p_query: query || null,
        p_starred_only: starredOnly,
        p_kind: kind,
        p_status: status,
        ...cursorArgs(cursor),
        p_limit: limit,
      }).select(RULE_COLUMNS)

      if (error) throw mapPostgrestError(error, httpStatus)
      return pageFrom(data ?? [], limit)
    },

    /**
     * The lobby's own RPC: tenant-wide, oldest first, fixed to pending. It
     * replaces a per-topic fan-out that capped each topic at 50 with no cursor
     * to page past, so once a topic held more than 50 pending rows the oldest
     * were silently unreachable.
     */
    async listPendingRules({ cursor = null, limit = PAGE_SIZE }: { cursor?: RuleCursor | null; limit?: number } = {}): Promise<RulePage> {
      const { data, error, status: httpStatus } = await client.rpc('list_pending_rules', {
        ...cursorArgs(cursor),
        p_limit: limit,
      }).select(RULE_COLUMNS)

      if (error) throw mapPostgrestError(error, httpStatus)
      return pageFrom(data ?? [], limit)
    },

    async setStar({ tipId, isStarred }: { tipId: string; isStarred: boolean }): Promise<Rule> {
      const { data, error, status } = await client
        .from('rules').update({ is_starred: isStarred }).eq('id', tipId).select(RULE_COLUMNS).maybeSingle()
      if (error) throw mapPostgrestError(error, status)
      if (!data) throw failed(404)
      return data
    },

    /** The lobby's positive decision: the rule becomes curated knowledge. */
    async approveRule(ruleId: string): Promise<Rule> {
      return updateStatus(client, ruleId, 'approved')
    },

    /**
     * The row is kept and only its status changes, never deleted: a rejected
     * rule must stay so the freshness window keeps seeing its normalized_text
     * and never regenerates the same rule forever.
     */
    async rejectRule(ruleId: string): Promise<Rule> {
      return updateStatus(client, ruleId, 'rejected')
    },

    /**
     * Corrects a rule's wording and classification from the approval lobby.
     *
     * `status` is deliberately not sent: editing is not a review decision, so a
     * pending rule stays pending after a correction and the reviewer still has
     * to approve or reject it. topic_id is included because re-filing a rule the
     * extractor put under the wrong topic is the third correction a reviewer
     * needs, and rejecting it was the only way to do that before.
     */
    async updateRule({ ruleId, text, kind, topicId }: {
      ruleId: string
      text: string
      kind: RuleKind
      topicId: string
    }): Promise<Rule> {
      const { data, error, status: httpStatus } = await client
        .from('rules').update({ text, kind, topic_id: topicId })
        .eq('id', ruleId).select(RULE_COLUMNS).maybeSingle()
      if (error) throw mapPostgrestError(error, httpStatus)
      if (!data) throw failed(404)
      return data
    },

    async loadKpis(): Promise<TenantKpis> {
      const { data, error, status } = await client.rpc('tenant_kpis').single()
      if (error) throw mapPostgrestError(error, status)
      if (!data) throw failed(404)

      // tenant_kpis returns bigint columns, which postgrest-js hands back as
      // strings because bigint exceeds the safe range for JSON numbers. Every
      // field needs Number() before it reaches the UI.
      const previous = Number(data.previous_items)
      const recent = Number(data.recent_items)

      return {
        knowledgeItems: Number(data.knowledge_items),
        qualityItems: Number(data.quality_items),
        growthPercent: previous === 0 ? null : Math.round(((recent - previous) / previous) * 100),
      }
    },
  }
}

export type RulesApi = ReturnType<typeof createRulesApi>
