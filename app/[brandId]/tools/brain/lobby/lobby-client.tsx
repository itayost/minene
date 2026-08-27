'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { createRolesApi, type RolesClient } from '../../../../../src/brain/roles-api'
import { RuleEditSheet, type RuleDraft } from '../../../../../src/brain/RuleEditSheet'
import { createRulesApi, type RulesApi, type RulesClient } from '../../../../../src/brain/rules-api'
import { getTopic, RULE_TOPICS } from '../../../../../src/brain/topics'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import type { Role, Rule, RuleKind } from '../../../../../src/brain/types'

const FIRST_TOPIC_ID = RULE_TOPICS[0]?.id ?? 'live'

const KIND_LABELS: Record<RuleKind, string> = { tip: 'טיפ', process: 'תהליך', case: 'מקרה' }
const kindLabel = (kind: RuleKind) => KIND_LABELS[kind] ?? 'טיפ'
const sourceLabel = (source: string) => (source === 'pdf' ? 'מתוך מסמך שהועלה' : 'נוצר אוטומטית')

/** A row whose topic is no longer in the catalogue still has to be editable. */
const editableTopic = (topicId: string) => (getTopic(topicId) ? topicId : FIRST_TOPIC_ID)

/**
 * Pages list_pending_rules until exhausted. The RPC is tenant-wide and oldest
 * first, which replaced a per-topic fan-out that capped each topic at 50 with no
 * cursor to page past, so once a topic held more than 50 pending rows the oldest
 * were silently unreachable.
 */
export async function loadAllPending(rulesApi: RulesApi): Promise<Rule[]> {
  const rows: Rule[] = []
  let cursor = null

  do {
    const page = await rulesApi.listPendingRules({ cursor })
    rows.push(...page.rows)
    cursor = page.nextCursor
  } while (cursor)

  return rows
}

type RequestState = { status: 'loading' | 'ready' } | { status: 'error'; message: string }

export function LobbyClient() {
  const rulesApi = useMemo(
    () => createRulesApi(createBrowserSupabase() as unknown as RulesClient),
    [],
  )
  const rolesApi = useMemo(
    () => createRolesApi(createBrowserSupabase() as unknown as RolesClient),
    [],
  )
  const handleError = useApiErrorHandler()

  const [requestState, setRequestState] = useState<RequestState>({ status: 'loading' })
  const [rows, setRows] = useState<Rule[]>([])
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [actionError, setActionError] = useState('')
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [editError, setEditError] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [ruleRoles, setRuleRoles] = useState<ReadonlyMap<string, string[]>>(() => new Map())

  const load = useCallback(async () => {
    setRequestState({ status: 'loading' })
    setActionError('')
    try {
      const pending = await loadAllPending(rulesApi)
      setRows(pending)
      setRequestState({ status: 'ready' })

      // After the queue, not alongside it. A failed role list must not blank the
      // queue: the sheet degrades to editing every axis except who a rule
      // addresses, which is a smaller loss than seeing no rules at all.
      try {
        const [catalogue, assigned] = await Promise.all([
          rolesApi.listRoles(),
          rolesApi.listRuleRoles({ ruleIds: pending.map((rule) => rule.id) }),
        ])
        setRoles(catalogue)
        setRuleRoles(assigned)
      } catch (rolesFailure) {
        handleError(rolesFailure)
      }
    } catch (error) {
      if (handleError(error)) {
        setRequestState({ status: 'error', message: 'לא הצלחנו לטעון את החוקים הממתינים לאישור' })
      }
    }
  }, [handleError, rolesApi, rulesApi])

  useEffect(() => { void load() }, [load])

  const withSaving = async (ruleId: string, work: () => Promise<void>) => {
    setSavingIds((current) => new Set(current).add(ruleId))
    try {
      await work()
    } finally {
      setSavingIds((current) => {
        const next = new Set(current)
        next.delete(ruleId)
        return next
      })
    }
  }

  const saveDraft = async () => {
    if (!draft) return
    if (!draft.text.trim()) {
      setEditError('לא ניתן לשמור חוק ריק')
      return
    }
    setEditError('')

    // rules_response_matches_kind refuses a case with no response at the database
    // level. Saying which field is missing here beats a constraint name nobody
    // can act on.
    if (draft.kind === 'case' && !draft.response.trim()) {
      setEditError('למקרה צריך גם תגובה: מה עושים כשזה קורה.')
      return
    }

    await withSaving(draft.ruleId, async () => {
      try {
        const saved = await rulesApi.updateRule({
          ruleId: draft.ruleId,
          text: draft.text,
          kind: draft.kind,
          topicId: draft.topicId,
          // Empty back to null on all three. The columns are nullable, and '' is
          // a sub-topic named the empty string: it sorts and filters as a real
          // value, which is how a cleared field becomes a permanent one.
          subTopic: draft.subTopic.trim() || null,
          polarity: draft.polarity || null,
          response: draft.kind === 'case' ? draft.response.trim() : null,
        })
        // rule_roles is a separate table, so it takes a separate call. Both
        // belong to the one correction the reviewer just made.
        await rolesApi.setRuleRoles({ ruleId: draft.ruleId, roleIds: draft.roleIds })
        setRuleRoles((current) => new Map(current).set(draft.ruleId, [...draft.roleIds]))
        setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
        setDraft(null)
      } catch (error) {
        if (handleError(error)) setEditError('לא הצלחנו לשמור את החוק. נסי שוב.')
      }
    })
  }

  const decide = async (rule: Rule, decision: 'approved' | 'rejected') => {
    setActionError('')

    await withSaving(rule.id, async () => {
      try {
        if (decision === 'approved') await rulesApi.approveRule(rule.id)
        else await rulesApi.rejectRule(rule.id)
        setRows((current) => current.filter((row) => row.id !== rule.id))
      } catch (error) {
        if (handleError(error)) {
          setActionError(decision === 'approved'
            ? 'לא הצלחנו לאשר את החוק. נסי שוב.'
            : 'לא הצלחנו לדחות את החוק. נסי שוב.')
        }
      }
    })
  }

  if (requestState.status === 'error') {
    return (
      <div className="brain-surface">
      <section aria-label="לובי אישור חוקים ממתינים" className="approval-lobby" dir="rtl">
        <h2>לובי אושר</h2>
        <p className="approval-lobby__error" role="alert">{requestState.message}</p>
      </section>
      </div>
    )
  }

  return (
    <div className="brain-surface">
    <section aria-label="לובי אישור חוקים ממתינים" className="approval-lobby" dir="rtl">
      <h2>לובי אושר</h2>
      <p className="approval-lobby__intro">
        כל חוק שממתין לאישור מופיע כאן, מהישן ביותר. בדקי כל אחד בנפרד ואשרי או דחי אותו.
      </p>

      <p className="approval-lobby__count" role="status">
        {requestState.status === 'loading'
          ? 'טוענת חוקים'
          : `${rows.length} חוקים ממתינים לאישור`}
      </p>

      {actionError ? <p className="approval-lobby__error" role="alert">{actionError}</p> : null}

      {requestState.status === 'ready' && rows.length === 0 ? (
        <p className="approval-lobby__empty">אין כרגע חוקים הממתינים לאישור.</p>
      ) : null}

      <ol className="approval-lobby__list">
        {rows.map((rule) => {
          const isSaving = savingIds.has(rule.id)
          return (
            <li className="approval-lobby__row" key={rule.id}>
              <p className="approval-lobby__text">{rule.text}</p>
              <p className="approval-lobby__meta">
                {`${getTopic(rule.topic_id)?.title ?? rule.topic_id} · ${kindLabel(rule.kind)} · ${sourceLabel(rule.source)}`}
              </p>

              <div className="approval-lobby__actions">
                {/* aria-label, not just the visible text: the labels repeat down
                    the list, so without naming the rule a screen-reader user has
                    no way to tell which one a button belongs to. */}
                <button
                  aria-label={`אישור: ${rule.text}`}
                  disabled={isSaving}
                  onClick={() => void decide(rule, 'approved')}
                  type="button"
                >
                  אישור
                </button>
                <button
                  aria-label={`עריכה: ${rule.text}`}
                  disabled={isSaving}
                  onClick={() => {
                    setEditError('')
                    setDraft({
                      ruleId: rule.id,
                      text: rule.text,
                      kind: rule.kind,
                      topicId: editableTopic(rule.topic_id),
                      subTopic: rule.sub_topic ?? '',
                      polarity: rule.polarity ?? '',
                      response: rule.response ?? '',
                      roleIds: ruleRoles.get(rule.id) ?? [],
                    })
                  }}
                  type="button"
                >
                  עריכה
                </button>
                {/* Last, so אישור keeps the leading position it has. */}
                <button
                  aria-label={`דחייה: ${rule.text}`}
                  disabled={isSaving}
                  onClick={() => void decide(rule, 'rejected')}
                  type="button"
                >
                  דחייה
                </button>
              </div>
            </li>
          )
        })}
      </ol>

      {draft ? (
        <RuleEditSheet
          draft={draft}
          error={editError}
          isSaving={savingIds.has(draft.ruleId)}
          onCancel={() => { setEditError(''); setDraft(null) }}
          onChange={setDraft}
          onSave={() => void saveDraft()}
          roles={roles}
        />
      ) : null}
    </section>
    </div>
  )
}
