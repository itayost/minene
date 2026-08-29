import { RulesApiError } from '../brain/rules-api'

/**
 * The rule is joined, not just its id. The ask IS the rule -- it passed the
 * brain's review gate, which is what makes it photographable, and the engine
 * refuses to open a conversation without one.
 */
const ASSIGNMENT_COLUMNS = 'id,rule_id,assignee_id,status,due_on,created_at'
const WITH_RULE = `${ASSIGNMENT_COLUMNS},rules(id,text,topic_id,kind,sub_topic,response)`

/** PostgREST's code for an expired or invalid JWT under row-level security. */
const POSTGREST_JWT_EXPIRED = 'PGRST301'

type PostgrestError = { code?: string | null }

const unauthorized = () => new RulesApiError('UNAUTHORIZED', 401, 'ההרשאה פגה. נא להתחבר מחדש.')
const failed = (status: number) =>
  new RulesApiError('REQUEST_FAILED', status, 'לא הצלחנו להשלים את הבקשה')

const mapError = (error: PostgrestError, status: number | undefined) =>
  error.code === POSTGREST_JWT_EXPIRED || status === 401 ? unauthorized() : failed(status ?? 500)

export type AssignmentStatus = 'open' | 'done' | 'not_done'

export type AssignmentRule = {
  id: string
  text: string
  topicId: string
  kind: string
  subTopic: string | null
  response: string | null
}

export type Assignment = {
  id: string
  ruleId: string
  assigneeId: string
  status: AssignmentStatus
  dueOn: string | null
  createdAt: string
  /**
   * Null when the join came back empty. The assignment is still rendered: a
   * task that vanishes from someone's list is worse than one that reads
   * awkwardly.
   */
  rule: AssignmentRule | null
}

type RuleRow = {
  id: string
  text: string
  topic_id: string
  kind: string
  sub_topic: string | null
  response: string | null
} | null

type AssignmentRow = {
  id: string
  rule_id: string
  assignee_id: string
  status: AssignmentStatus
  due_on: string | null
  created_at: string
  rules?: RuleRow
}

type Result<T> = { data: T | null; error: PostgrestError | null; status?: number }

type Query = {
  select: (columns: string) => Query
  eq: (column: string, value: unknown) => Query
  order: (column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => Query
  insert: (values: Record<string, unknown>) => Query
  maybeSingle: () => PromiseLike<Result<AssignmentRow>>
} & PromiseLike<Result<AssignmentRow[]>>

export type AssignmentsClient = {
  from: (table: string) => Query
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => {
    maybeSingle: () => PromiseLike<Result<AssignmentRow>>
  } & PromiseLike<Result<unknown>>
}

const asRule = (row: RuleRow): AssignmentRule | null =>
  row
    ? {
        id: row.id,
        text: row.text,
        topicId: row.topic_id,
        kind: row.kind,
        subTopic: row.sub_topic,
        response: row.response,
      }
    : null

const asAssignment = (row: AssignmentRow): Assignment => ({
  id: row.id,
  ruleId: row.rule_id,
  assigneeId: row.assignee_id,
  status: row.status,
  dueOn: row.due_on,
  createdAt: row.created_at,
  rule: asRule(row.rules ?? null),
})

export function createAssignmentsApi(client: AssignmentsClient) {
  return {
    /**
     * What this person still has to do.
     *
     * No assignee argument: assignments_select_own returns a staff member's own
     * rows and assignments_select_owner returns the tenant's, so the policy is
     * the filter. An owner calling this gets the whole tenant, which is the
     * right answer for a manager view rather than an accident.
     */
    async listOpenAssignments(): Promise<Assignment[]> {
      const { data, error, status } = await client
        .from('assignments')
        .select(WITH_RULE)
        .eq('status', 'open')
        .order('due_on', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: true })

      if (error) throw mapError(error, status)
      return (data ?? []).map(asAssignment)
    },

    /**
     * Closing an assignment. The status and the event explaining it are written
     * together by the RPC: a status with no event is a state nobody can account
     * for.
     *
     * `source` is deliberately not a parameter. The function derives it from
     * who is calling, so a person reporting on themselves cannot be recorded as
     * a manager having observed them.
     */
    async settleAssignment({
      assignmentId,
      status,
      note = null,
    }: {
      assignmentId: string
      status: Exclude<AssignmentStatus, 'open'>
      note?: string | null
    }): Promise<Assignment> {
      const {
        data,
        error,
        status: httpStatus,
      } = await client
        .rpc('settle_assignment', {
          p_assignment_id: assignmentId,
          p_status: status,
          p_note: note,
        })
        .maybeSingle()

      if (error) throw mapError(error, httpStatus)
      if (!data) throw failed(404)
      return asAssignment(data)
    },
  }
}

export type AssignmentsApi = ReturnType<typeof createAssignmentsApi>
