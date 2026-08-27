'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserSupabase } from '../../../../src/auth/supabase-browser'
import { KnowledgeRow } from '../../../../src/brain/KnowledgeRow'
import { createRolesApi, type RolesClient } from '../../../../src/brain/roles-api'
import { createRulesApi, type RulesClient } from '../../../../src/brain/rules-api'
import { SubmitKnowledge } from '../../../../src/brain/SubmitKnowledge'
import { useApiErrorHandler } from '../../../../src/brain/use-api-error'
import type { Role, Rule } from '../../../../src/brain/types'

/**
 * The four ways the floor reads the knowledge base, and one of them is not like
 * the others: `proven` calls its own RPC because it is a ranking by rating
 * rather than a filtered feed. Keeping that difference in this table, rather
 * than as a branch buried in the loader, is what stops it being mistaken for one
 * more filter.
 */
const TABS = [
  { id: 'rules', label: 'כל החוקים' },
  { id: 'dos', label: 'עשה ואל תעשה' },
  { id: 'cases', label: 'מקרים ותגובות' },
  { id: 'proven', label: 'תהליכים מוכחים' },
] as const

type TabId = (typeof TABS)[number]['id']

const EMPTY_MESSAGES: Record<TabId, string> = {
  rules: 'עדיין אין חוקים מאושרים.',
  dos: 'עדיין אין הנחיות עשה ואל תעשה לתפקיד הזה.',
  cases: 'עדיין אין מקרים מתועדים.',
  // Says WHY it is empty, not just that it is. "אין תהליכים מוכחים" reads as
  // "this business has no good processes", when the cause is almost always that
  // nobody has voted yet: a different problem, with a different fix, and one the
  // reader can act on.
  proven: 'עדיין אין מספיק דירוגים כדי לקבוע אילו תהליכים הוכחו כיעילים.',
}

/** A rule addressing no role addresses everyone, so this is a real option. */
const ALL_ROLES: Role = { id: '', name: 'כל התפקידים', sortOrder: -1 }

type LoadState = { status: 'loading' | 'ready' } | { status: 'error'; message: string }

export function BookClient({ role }: { role: 'owner' | 'staff' }) {
  const rulesApi = useMemo(() => createRulesApi(createBrowserSupabase() as unknown as RulesClient), [])
  const rolesApi = useMemo(() => createRolesApi(createBrowserSupabase() as unknown as RolesClient), [])
  const handleError = useApiErrorHandler()

  const [tab, setTab] = useState<TabId>('rules')
  const [roleId, setRoleId] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [rows, setRows] = useState<Rule[]>([])
  const [votes, setVotes] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [actionError, setActionError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    rolesApi.listRoles()
      .then((loaded) => { if (!cancelled) setRoles(loaded) })
      // A failed role list is not worth failing the page over: only the
      // עשה ואל תעשה filter needs it, and that tab degrades to every role, which
      // is a superset. handleError still runs so an expired session redirects.
      .catch((error) => { if (!cancelled) handleError(error) })
    return () => { cancelled = true }
  }, [handleError, rolesApi])

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    const load = async (): Promise<Rule[]> => {
      if (tab === 'proven') return rulesApi.listProvenProcesses()
      if (tab === 'cases') return (await rulesApi.listRules({ topicId: null, kind: 'case' })).rows
      if (tab === 'dos') {
        // Two calls, not one filtered client-side. A single unfiltered page
        // would spend its fifty-row budget mostly on rules with no polarity at
        // all, which are the majority, and both lists would come back short for
        // a reason the reader cannot see.
        const [dos, donts] = await Promise.all([
          rulesApi.listRules({ topicId: null, polarity: 'do', roleId: roleId || null }),
          rulesApi.listRules({ topicId: null, polarity: 'dont', roleId: roleId || null }),
        ])
        return [...dos.rows, ...donts.rows]
      }
      return (await rulesApi.listRules({ topicId: null })).rows
    }

    Promise.all([load(), rulesApi.listMyVotes()])
      .then(([found, myVotes]) => {
        if (cancelled) return
        setRows(found)
        setVotes(myVotes)
        setState({ status: 'ready' })
      })
      .catch((error) => {
        if (cancelled) return
        if (handleError(error)) setState({ status: 'error', message: 'לא הצלחנו לטעון את הידע כרגע' })
      })

    return () => { cancelled = true }
  }, [handleError, reloadKey, roleId, rulesApi, tab])

  const withSaving = useCallback(async (ruleId: string, work: () => Promise<unknown>) => {
    setSavingIds((current) => new Set(current).add(ruleId))
    setActionError('')
    try {
      await work()
      return true
    } catch (error) {
      if (handleError(error)) setActionError('הדירוג לא נשמר. נסי שוב.')
      return false
    } finally {
      setSavingIds((current) => {
        const next = new Set(current)
        next.delete(ruleId)
        return next
      })
    }
  }, [handleError])

  /**
   * Optimistic on the vote, and deliberately not on the percentage. The vote is
   * this person's own state and they just chose it, so echoing it back instantly
   * is honest. The percentage is an aggregate a trigger recomputes, and guessing
   * at it here would show a number that is subtly wrong until the next load.
   */
  const onVote = useCallback(async (ruleId: string, isLike: boolean) => {
    const saved = await withSaving(ruleId, () => rulesApi.setRuleVote({ ruleId, isLike }))
    if (saved) setVotes((current) => new Map(current).set(ruleId, isLike))
  }, [rulesApi, withSaving])

  const onClear = useCallback(async (ruleId: string) => {
    const saved = await withSaving(ruleId, () => rulesApi.clearRuleVote({ ruleId }))
    if (saved) {
      setVotes((current) => {
        const next = new Map(current)
        next.delete(ruleId)
        return next
      })
    }
  }, [rulesApi, withSaving])

  const list = (items: Rule[], labelledBy?: string) => (
    <ul aria-labelledby={labelledBy} className="knowledge-list">
      {items.map((rule) => (
        <KnowledgeRow
          isSaving={savingIds.has(rule.id)}
          key={rule.id}
          onClear={(id) => void onClear(id)}
          onVote={(id, isLike) => void onVote(id, isLike)}
          rule={rule}
          vote={votes.get(rule.id)}
        />
      ))}
    </ul>
  )

  const isDosTab = tab === 'dos'
  const dos = rows.filter((rule) => rule.polarity === 'do')
  const donts = rows.filter((rule) => rule.polarity === 'dont')

  return (
    <div className="brain-surface">
      <section aria-label="ספר החוקים" className="knowledge-shell" dir="rtl">
        <h2>ספר החוקים</h2>

        <div aria-label="תצוגות הידע" className="knowledge-tabs knowledge-tabs--grid" role="tablist">
          {TABS.map((item) => (
            <button
              aria-selected={tab === item.id}
              className="knowledge-tab"
              key={item.id}
              onClick={() => setTab(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        {isDosTab ? (
          <label className="knowledge-role-filter">
            <span>תפקיד</span>
            <select onChange={(event) => setRoleId(event.target.value)} value={roleId}>
              {[ALL_ROLES, ...roles].map((role) => (
                <option key={role.id || 'all'} value={role.id}>{role.name}</option>
              ))}
            </select>
          </label>
        ) : null}

        <SubmitKnowledge onSubmitted={() => setReloadKey((key) => key + 1)} rulesApi={rulesApi} />

        {actionError ? <p className="knowledge-message" role="alert">{actionError}</p> : null}

        {state.status === 'error' ? (
          <p className="knowledge-message" role="alert">{state.message}</p>
        ) : state.status === 'loading' ? (
          <p className="knowledge-message">טוענת…</p>
        ) : rows.length === 0 ? (
          <p className="knowledge-message">{EMPTY_MESSAGES[tab]}</p>
        ) : isDosTab ? (
          <>
            {/* Two headed lists rather than one mixed list with a badge per row.
                "What to do" and "what never to do" are read as separate
                checklists, and interleaving them makes a reader parse each row
                before knowing which kind it is. */}
            <h3 className="knowledge-heading" data-polarity="do" id="knowledge-dos">עשה</h3>
            {dos.length ? list(dos, 'knowledge-dos') : <p className="knowledge-message">אין הנחיות עשה לתפקיד הזה.</p>}
            <h3 className="knowledge-heading" data-polarity="dont" id="knowledge-donts">אל תעשה</h3>
            {donts.length ? list(donts, 'knowledge-donts') : <p className="knowledge-message">אין הנחיות אל תעשה לתפקיד הזה.</p>}
          </>
        ) : (
          list(rows)
        )}
      </section>
    </div>
  )
}
