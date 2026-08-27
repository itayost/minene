/**
 * A framing split, not a quality split: the same knowledge is a tip, a process
 * or a case by how it is phrased. `case` carries a `response`; the other two
 * leave it null.
 */
export type RuleKind = 'tip' | 'process' | 'case'
export type RuleStatus = 'pending' | 'approved' | 'rejected'

/**
 * Provenance only. It says where a rule came from, never how good it is, which
 * is what status is for -- every one of these lands `pending` regardless.
 */
export type RuleSource = 'generated' | 'pdf' | 'internal' | 'conversation' | 'external'

/**
 * An axis that crosses `kind` rather than extending it: a process can be
 * phrased as an instruction or as a prohibition, and most rules are neither.
 */
export type RulePolarity = 'do' | 'dont'
export type DocumentStatus = 'processing' | 'ready' | 'failed'

/**
 * Two ways in, one pipeline. A pdf is an object in the private bucket at
 * storage_path; a conversation is a transcript held in raw_text with no object
 * at all. documents_source_shape enforces that exactly one of the two is set.
 */
export type DocumentSourceType = 'pdf' | 'conversation'

/**
 * Exactly the columns the API selects. Adding a field here without adding it to
 * RULE_COLUMNS produces a property that is always undefined at runtime.
 */
export type Rule = {
  id: string
  /**
   * Per-tenant sequential identifier shown to people, assigned by a trigger and
   * never reused. Not null: the backfill gave every pre-existing rule one.
   */
  rule_number: number
  topic_id: string
  sub_topic: string | null
  text: string
  /** The answer to a situation. Set only when kind is 'case'. */
  response: string | null
  created_at: string
  kind: RuleKind
  polarity: RulePolarity | null
  status: RuleStatus
  source: RuleSource
  /** Where on the web this was found. Set only when source is 'external'. */
  source_url: string | null
  like_count: number
  vote_count: number
  /**
   * null when nobody has voted, never 0: "no data" and "everybody disliked it"
   * are opposite facts and the UI renders them differently. like_count and
   * vote_count come alongside because 72% off four votes and 72% off forty are
   * different claims, and the reader needs the denominator to tell them apart.
   */
  like_pct: number | null
}

/**
 * Keyset pagination. list_rules orders by (created_at desc, id desc), so both
 * fields are needed to resume unambiguously when two rows share a timestamp.
 */
export type RuleCursor = { created_at: string; id: string }

export type RulePage = { rows: Rule[]; nextCursor: RuleCursor | null }

export type BrainDocument = {
  id: string
  topic_id: string
  filename: string
  status: DocumentStatus
  error: string | null
  created_at: string
  source_type: DocumentSourceType
}

/**
 * growthPercent is null when there is no prior seven-day baseline, which is the
 * normal state for a tenant in its first fortnight rather than a rare edge case.
 * Never 0, which would falsely claim flat growth, and never Infinity, which is
 * unrenderable. The KPI cards render null as "חדש".
 */
export type TenantKpis = {
  knowledgeItems: number
  qualityItems: number
  growthPercent: number | null
}

export type Topic = { id: string; title: string; lines: readonly string[] }

/**
 * A sub-topic and how many rules sit under it, read back from the rules in use
 * rather than stored. ruleCount arrives as a bigint string and is converted
 * before it leaves the API.
 */
export type SubTopicCount = { subTopic: string; ruleCount: number }

/** One person's verdict on one rule. */
export type RuleVote = { ruleId: string; isLike: boolean }

/**
 * A job in this business, as an editable per-tenant catalogue rather than a
 * fixed list: one chain has assistant managers and stockroom staff, another
 * does not, and a check constraint would make adding a role a migration.
 */
export type Role = { id: string; name: string; sortOrder: number }

/** The two tenant roles. Not a job: this is what the policies branch on. */
export type TenantRole = 'owner' | 'staff'

/**
 * Someone with an account in this tenant. `role` is what the database admits
 * them to; `jobRoleId` is what they do on the floor, and is what makes a
 * do/don't list personal.
 */
export type Person = {
  id: string
  displayName: string | null
  role: TenantRole
  jobRoleId: string | null
}
