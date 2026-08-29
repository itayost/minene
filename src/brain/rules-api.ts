import type {
  Rule,
  RuleCursor,
  RuleKind,
  RulePage,
  RulePolarity,
  RuleStatus,
  RuleVote,
  SubTopicCount,
  TenantKpis,
} from './types'

const PAGE_SIZE = 50

/**
 * status and source are selected because the approval lobby needs both: a
 * pending rule's review state, and where it came from.
 *
 * like_count and vote_count come alongside like_pct even though the percentage
 * is what gets rendered: 72% off four votes and 72% off forty are different
 * claims, and the UI needs the denominator to say so.
 *
 * Every field on Rule must appear here. One that does not is not a type error
 * anywhere; it is a property that is always undefined at runtime.
 */
const RULE_COLUMNS = [
  'id',
  'rule_number',
  'topic_id',
  'sub_topic',
  'text',
  'response',
  'created_at',
  'kind',
  'polarity',
  'status',
  'source',
  'source_url',
  'like_count',
  'vote_count',
  'like_pct',
].join(',')

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

/**
 * DUPLICATE_ROLE and EMPTY_NAME belong to the roles table rather than to rules,
 * and live on this union because they are raised as RulesApiError: a fourth
 * error class would have to be taught to useApiErrorHandler before an expired
 * session on a roles surface sent anyone back to sign in.
 */
export type RulesApiCode = 'UNAUTHORIZED' | 'REQUEST_FAILED' | 'DUPLICATE_ROLE' | 'EMPTY_NAME'

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
const failed = (status: number) =>
  new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')

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
const mapPostgrestError = (error: PostgrestError, status: number | undefined) =>
  error.code === POSTGREST_JWT_EXPIRED || status === 401 ? unauthorized() : failed(status ?? 500)

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

type SubTopicRow = { sub_topic: string; rule_count: string | number }
type VoteRow = { rule_id: string; is_like: boolean }

/**
 * A postgrest-js rpc() call is awaitable on its own and also offers .select,
 * .single and .maybeSingle. Both shapes are in use here: the sub-topic catalog
 * and a cleared vote await it directly, everything else refines it first.
 */
type RpcCall = PromiseLike<PostgrestResult<SubTopicRow[]>> & {
  select: (columns: string) => PromiseLike<PostgrestResult<Rule[]>>
  single: () => PromiseLike<PostgrestResult<KpiRow>>
  maybeSingle: <T>() => PromiseLike<PostgrestResult<T>>
}

/**
 * Narrower than SupabaseClient on purpose. This module needs function
 * invocations, a handful of RPCs and two tables, and depending on more than
 * that would make it untestable without a live project. Supabase's generated
 * types are also deep enough that structurally comparing the whole client trips
 * TS2589.
 */
export type RulesClient = {
  functions: {
    invoke: (
      name: string,
      options: { body: unknown },
    ) => PromiseLike<{
      data: unknown
      error: { context?: { status?: number } } | null
    }>
  }
  rpc: (name: string, args?: Record<string, unknown>) => RpcCall
  from: (table: string) => {
    update: (values: Record<string, unknown>) => RuleFilter
    select: (columns: string) => PromiseLike<PostgrestResult<VoteRow[]>>
  }
}

/**
 * Shared by approveRule and rejectRule: both move a rule through the review
 * lifecycle by writing `status` alone. The database grants update on specific
 * columns rather than the whole row, and normalized_text is deliberately never
 * among them: it is the dedupe key, a trigger derives it from `text`, and
 * sending it would fail the whole update at 42501.
 */
async function updateStatus(
  client: RulesClient,
  ruleId: string,
  status: RuleStatus,
): Promise<Rule> {
  const {
    data,
    error,
    status: httpStatus,
  } = await client
    .from('rules')
    .update({ status })
    .eq('id', ruleId)
    .select(RULE_COLUMNS)
    .maybeSingle()
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
  kind?: RuleKind | null
  status?: RuleStatus | null
  subTopic?: string | null
  polarity?: RulePolarity | null
  roleId?: string | null
  cursor?: RuleCursor | null
  limit?: number
}

/**
 * The axes a rule can be corrected on, and the shape a new submission arrives
 * in. They are the same set because a reviewer fixing a classification and a
 * manager proposing one are doing the same thing to the same columns.
 */
export type RuleClassification = {
  subTopic?: string | null
  polarity?: RulePolarity | null
  response?: string | null
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
     * "צייד ידע חיצוני": go and look on the web for best practices on a topic.
     * Same invocation shape as generateTips -- supabase-js attaches the
     * session's bearer token, and the function reads the tenant from it rather
     * than from the body.
     *
     * Zero rules back is a success, not an error: everything the hunt found was
     * already inside the freshness window. The caller renders that as a
     * sentence, not as a failure.
     */
    async huntExternal({
      topicId,
      subTopic = null,
    }: {
      topicId: string
      subTopic?: string | null
    }): Promise<unknown> {
      const { data, error } = await client.functions.invoke('hunt-external', {
        body: { topicId, subTopic },
      })
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
      kind = null,
      status = 'approved',
      subTopic = null,
      polarity = null,
      roleId = null,
      cursor = null,
      limit = PAGE_SIZE,
    }: ListRulesOptions): Promise<RulePage> {
      const {
        data,
        error,
        status: httpStatus,
      } = await client
        .rpc('list_rules', {
          p_topic_id: topicId,
          p_query: query || null,
          p_kind: kind,
          p_status: status,
          ...cursorArgs(cursor),
          p_limit: limit,
          // null means "no filter", the same convention kind and status already
          // follow, so a caller that names none of the three keeps its behaviour.
          p_sub_topic: subTopic,
          p_polarity: polarity,
          p_role_id: roleId,
        })
        .select(RULE_COLUMNS)

      if (error) throw mapPostgrestError(error, httpStatus)
      return pageFrom(data ?? [], limit)
    },

    /**
     * The lobby's own RPC: tenant-wide, oldest first, fixed to pending. It
     * replaces a per-topic fan-out that capped each topic at 50 with no cursor
     * to page past, so once a topic held more than 50 pending rows the oldest
     * were silently unreachable.
     */
    async listPendingRules({
      cursor = null,
      limit = PAGE_SIZE,
    }: {
      cursor?: RuleCursor | null
      limit?: number
    } = {}): Promise<RulePage> {
      const {
        data,
        error,
        status: httpStatus,
      } = await client
        .rpc('list_pending_rules', {
          ...cursorArgs(cursor),
          p_limit: limit,
        })
        .select(RULE_COLUMNS)

      if (error) throw mapPostgrestError(error, httpStatus)
      return pageFrom(data ?? [], limit)
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
    async updateRule({
      ruleId,
      text,
      kind,
      topicId,
      subTopic = null,
      polarity = null,
      response = null,
    }: {
      ruleId: string
      text: string
      kind: RuleKind
      topicId: string
    } & RuleClassification): Promise<Rule> {
      const {
        data,
        error,
        status: httpStatus,
      } = await client
        // Each of the three is sent as an explicit null rather than omitted when
        // the caller does not pass it, and that has a real consequence: clearing
        // a wrong sub-topic or polarity has to be possible, and an object that
        // drops undefined keys cannot express "set this back to nothing".
        // Callers therefore pass the CURRENT value for anything they are not
        // changing, which the edit sheet does because it edits a whole rule.
        .from('rules')
        .update({ text, kind, topic_id: topicId, sub_topic: subTopic, polarity, response })
        .eq('id', ruleId)
        .select(RULE_COLUMNS)
        .maybeSingle()
      if (error) throw mapPostgrestError(error, httpStatus)
      if (!data) throw failed(404)
      return data
    },

    /**
     * "תהליכים ארגוניים": the processes people have actually rated as working,
     * ranked rather than listed. Its own RPC because it orders by rating instead
     * of by recency, which no cursor over (created_at, id) can express.
     *
     * Unpaged, and that is the design: a top-N ranking is not a queue, and the
     * RPC caps the limit regardless of what is asked for.
     */
    async listProvenProcesses({
      minVotes = 3,
      minLikePct = 60,
      limit = 20,
    }: {
      minVotes?: number
      minLikePct?: number
      limit?: number
    } = {}): Promise<Rule[]> {
      const { data, error, status } = await client
        .rpc('list_proven_processes', {
          p_min_votes: minVotes,
          p_min_like_pct: minLikePct,
          p_limit: limit,
        })
        .select(RULE_COLUMNS)
      if (error) throw mapPostgrestError(error, status)
      return data ?? []
    },

    /**
     * The sub-topic catalog, read back from the rules in use rather than stored.
     * An empty catalog is the normal starting state for a tenant that has
     * classified nothing yet, so it comes back as [] rather than as a failure:
     * the filter that renders it simply has no options to offer.
     */
    async listRuleSubTopics({
      topicId = null,
      status = 'approved',
    }: {
      topicId?: string | null
      status?: RuleStatus | null
    } = {}): Promise<SubTopicCount[]> {
      const {
        data,
        error,
        status: httpStatus,
      } = await client.rpc('list_rule_sub_topics', {
        p_topic_id: topicId,
        p_status: status,
      })
      if (error) throw mapPostgrestError(error, httpStatus)
      // rule_count is a bigint, which postgrest-js hands back as a string for
      // the same reason the KPI columns arrive as strings. Number() is required
      // before it reaches the UI, not optional: '9' sorts above '14'.
      return (data ?? []).map((row) => ({
        subTopic: row.sub_topic,
        ruleCount: Number(row.rule_count),
      }))
    },

    /**
     * Cast or change this person's vote on one rule. The RPC supplies the voter
     * from the session, so there is no id for a caller to get wrong.
     */
    async setRuleVote({ ruleId, isLike }: { ruleId: string; isLike: boolean }): Promise<RuleVote> {
      const { data, error, status } = await client
        .rpc('set_rule_vote', {
          p_rule_id: ruleId,
          p_is_like: isLike,
        })
        .maybeSingle<VoteRow>()
      if (error) throw mapPostgrestError(error, status)
      if (!data) throw failed(404)
      return { ruleId: data.rule_id, isLike: data.is_like }
    },

    /**
     * Withdrawing a vote, which is not the same as voting "no": a cleared vote
     * leaves the denominator, a dislike stays in it.
     */
    async clearRuleVote({ ruleId }: { ruleId: string }): Promise<void> {
      const { error, status } = await client.rpc('clear_rule_vote', { p_rule_id: ruleId })
      if (error) throw mapPostgrestError(error, status)
    },

    /**
     * This person's own votes. rule_votes_select_own means the query cannot
     * return anyone else's even if a caller asked for them, so there is no
     * filtering by person here: the policy is the filter.
     *
     * A Map rather than an array because every call site wants "how did I vote
     * on THIS rule" while rendering a list, and an array makes that a linear
     * scan per row.
     */
    async listMyVotes(): Promise<Map<string, boolean>> {
      const { data, error, status } = await client.from('rule_votes').select('rule_id,is_like')
      if (error) throw mapPostgrestError(error, status)
      return new Map((data ?? []).map((row) => [row.rule_id, row.is_like]))
    },

    /**
     * "צייד ידע פנימי": a person in the tenant contributes what they know. It
     * lands pending and goes through the same approval lobby as an extracted or
     * generated rule, deliberately -- "a manager typed it" is not the same as
     * "the business has adopted it", and the review gate is where that
     * difference gets settled.
     *
     * The returned row matters more than it looks: rules_select_member_approved
     * admits approved rows only, so a submitter cannot read their own pending
     * row back. This response is the only confirmation they get.
     */
    async submitInternalRule({
      topicId,
      text,
      kind = 'tip',
      subTopic = null,
      polarity = null,
      response = null,
    }: {
      topicId: string
      text: string
      kind?: RuleKind
    } & RuleClassification): Promise<Rule> {
      const { data, error, status } = await client
        .rpc('submit_internal_rule', {
          p_topic_id: topicId,
          p_text: text,
          p_kind: kind,
          p_sub_topic: subTopic,
          p_polarity: polarity,
          p_response: response,
        })
        .maybeSingle<Rule>()
      if (error) throw mapPostgrestError(error, status)
      if (!data) throw failed(500)
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
