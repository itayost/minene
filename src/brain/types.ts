export type RuleKind = 'tip' | 'process'
export type RuleStatus = 'pending' | 'approved' | 'rejected'
export type RuleSource = 'generated' | 'pdf'
export type DocumentStatus = 'processing' | 'ready' | 'failed'

/**
 * Exactly the columns the API selects. Adding a field here without adding it to
 * RULE_COLUMNS produces a property that is always undefined at runtime.
 */
export type Rule = {
  id: string
  topic_id: string
  text: string
  is_starred: boolean
  created_at: string
  kind: RuleKind
  status: RuleStatus
  source: RuleSource
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
