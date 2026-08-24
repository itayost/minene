'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { KpiCards, type KpiState } from '../../../../../src/brain/KpiCards'
import { createRulesApi, type RulesClient } from '../../../../../src/brain/rules-api'
import { getTopic, RULE_TOPICS } from '../../../../../src/brain/topics'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import type { Rule, RuleCursor, RuleKind } from '../../../../../src/brain/types'

type Filters = { query: string; starredOnly: boolean; kind: RuleKind | null }

const INITIAL_FILTERS: Filters = { query: '', starredOnly: false, kind: null }

/** null means every topic, which list_rules reads as no filter. */
const TABS: readonly { id: string | null; title: string }[] = [
  { id: null, title: 'הכל' },
  ...RULE_TOPICS.map((topic) => ({ id: topic.id, title: topic.title })),
]

const kindLabel = (kind: RuleKind) => (kind === 'process' ? 'תהליך' : 'טיפ')

const SEARCH_PANEL_ID = 'admin-search-panel'

/* Inline rather than a lucide import: BrandShell draws its own icons this way,
   and one glyph is not worth a dependency. */
const searchIcon = (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="9" cy="9" r="6" />
    <path d="m13.5 13.5 4 4" strokeLinecap="round" />
  </svg>
)

type RequestState = { status: 'loading' | 'ready' } | { status: 'error'; message: string }

export function AdminClient() {
  const rulesApi = useMemo(
    () => createRulesApi(createBrowserSupabase() as unknown as RulesClient),
    [],
  )
  const handleError = useApiErrorHandler()

  const [topicId, setTopicId] = useState<string | null>(null)
  const [draftQuery, setDraftQuery] = useState('')
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS)
  const [cursorStack, setCursorStack] = useState<(RuleCursor | null)[]>([null])
  const [result, setResult] = useState<{ rows: Rule[]; nextCursor: RuleCursor | null }>({ rows: [], nextCursor: null })
  const [requestState, setRequestState] = useState<RequestState>({ status: 'loading' })
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [starError, setStarError] = useState('')
  const [kpiState, setKpiState] = useState<KpiState>({ status: 'loading' })
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Guards against a slow earlier request landing after a faster later one and
  // overwriting it. Switching topics quickly is exactly how that happens.
  const requestId = useRef(0)

  const cursor = cursorStack[cursorStack.length - 1] ?? null

  // Counts only what is hidden behind the toggle while it is shut. An applied
  // search term is not included: it stays spelled out in its own chip below, so
  // counting it here would report the same filter twice.
  const hiddenFilterCount = (filters.starredOnly ? 1 : 0) + (filters.kind ? 1 : 0)

  // Opening a search control that does not take focus makes the reader hunt for
  // the field they just asked for.
  useEffect(() => {
    if (isSearchOpen) searchInputRef.current?.focus()
  }, [isSearchOpen])

  const loadRules = useCallback(async () => {
    const id = ++requestId.current
    setRequestState({ status: 'loading' })
    setResult({ rows: [], nextCursor: null })

    try {
      const page = await rulesApi.listRules({ topicId, cursor, ...filters })
      if (id !== requestId.current) return
      setResult(page)
      setRequestState({ status: 'ready' })
    } catch (error) {
      if (id !== requestId.current) return
      if (handleError(error)) setRequestState({ status: 'error', message: 'לא הצלחנו לטעון את החוקים' })
    }
  }, [cursor, filters, handleError, rulesApi, topicId])

  useEffect(() => { void loadRules() }, [loadRules])

  useEffect(() => {
    let cancelled = false
    setKpiState({ status: 'loading' })

    rulesApi.loadKpis()
      .then((kpis) => { if (!cancelled) setKpiState({ status: 'ready', ...kpis }) })
      .catch((error: unknown) => { if (handleError(error) && !cancelled) setKpiState({ status: 'error' }) })

    return () => { cancelled = true }
  }, [handleError, rulesApi])

  /** Any filter change invalidates the cursor stack: page 2 of one filter is not page 2 of another. */
  const applyFilters = (changes: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...changes }))
    setCursorStack([null])
  }

  const toggleStar = async (rule: Rule) => {
    setStarError('')
    setSavingIds((current) => new Set(current).add(rule.id))

    try {
      const saved = await rulesApi.setStar({ tipId: rule.id, isStarred: !rule.is_starred })
      setResult((current) => ({
        ...current,
        rows: current.rows.map((row) => (row.id === saved.id ? saved : row)),
      }))
    } catch (error) {
      if (handleError(error)) setStarError('לא הצלחנו לעדכן את הסימון. נסי שוב.')
    } finally {
      setSavingIds((current) => {
        const next = new Set(current)
        next.delete(rule.id)
        return next
      })
    }
  }

  return (
    <div className="brain-surface">
    <section aria-label="היסטוריית החוקים" className="admin-screen" dir="rtl">
      <header className="admin-header">
        <h2>נתוני המוח</h2>

        <button
          aria-controls={SEARCH_PANEL_ID}
          aria-expanded={isSearchOpen}
          aria-label="חיפוש וסינון"
          className="admin-search-toggle"
          onClick={() => setIsSearchOpen((open) => !open)}
          type="button"
        >
          {searchIcon}
          {hiddenFilterCount > 0 ? (
            <span aria-hidden="true" className="admin-search-toggle__count">{hiddenFilterCount}</span>
          ) : null}
        </button>
      </header>

      <KpiCards state={kpiState} />

      <nav aria-label="סינון לפי נושא" className="admin-tabs">
        {TABS.map((tab) => (
          <button
            aria-current={tab.id === topicId ? 'true' : undefined}
            className="admin-tab"
            key={tab.id ?? 'all'}
            onClick={() => { setTopicId(tab.id); setCursorStack([null]) }}
            type="button"
          >
            {tab.title}
          </button>
        ))}
      </nav>

      {/* hidden, not unmounted: the panel keeps its draft text between openings,
          and aria-controls must point at an element that exists. */}
      <section
        aria-label="חיפוש וסינון חוקים"
        className="admin-panel"
        hidden={!isSearchOpen}
        id={SEARCH_PANEL_ID}
      >
        <form
          className="admin-search"
          onSubmit={(event) => { event.preventDefault(); applyFilters({ query: draftQuery }) }}
        >
          <label htmlFor="admin-query">חיפוש בחוקים</label>
          <div className="admin-search__row">
            <input
              // A phone keyboard reads these: `search` puts a search key where
              // the newline key would be, and the three switches stop iOS
              // autocapitalising and autocorrecting Hebrew search terms.
              autoCapitalize="off"
              autoComplete="off"
              autoCorrect="off"
              enterKeyHint="search"
              id="admin-query"
              onChange={(event) => setDraftQuery(event.target.value)}
              ref={searchInputRef}
              type="search"
              value={draftQuery}
            />
            <button type="submit">חיפוש</button>
          </div>
        </form>

        <div className="admin-filters">
          <label>
            <input
              checked={filters.starredOnly}
              onChange={(event) => applyFilters({ starredOnly: event.target.checked })}
              type="checkbox"
            />
            <span>מסומנים בלבד</span>
          </label>

          <label htmlFor="admin-kind">סוג</label>
          <select
            id="admin-kind"
            onChange={(event) => applyFilters({ kind: (event.target.value || null) as RuleKind | null })}
            value={filters.kind ?? ''}
          >
            <option value="">הכל</option>
            <option value="tip">טיפ</option>
            <option value="process">תהליך</option>
          </select>
        </div>
      </section>

      {filters.query ? (
        <p className="admin-chip">
          <span>{`חיפוש: ${filters.query}`}</span>
          <button
            aria-label={`ניקוי החיפוש: ${filters.query}`}
            onClick={() => { setDraftQuery(''); applyFilters({ query: '' }) }}
            type="button"
          >
            ניקוי
          </button>
        </p>
      ) : null}

      {starError ? <p className="admin-error" role="alert">{starError}</p> : null}

      {requestState.status === 'error' ? (
        <p className="admin-error" role="alert">{requestState.message}</p>
      ) : (
        <>
          <p className="admin-count" role="status">
            {requestState.status === 'loading' ? 'טוענת חוקים' : `${result.rows.length} חוקים`}
          </p>

          {requestState.status === 'ready' && result.rows.length === 0 ? (
            <p className="admin-empty">לא נמצאו חוקים התואמים לסינון.</p>
          ) : null}

          <ol className="admin-list">
            {result.rows.map((rule) => (
              <li className="admin-row" key={rule.id}>
                <p className="admin-row__text">{rule.text}</p>
                <p className="admin-row__meta">
                  {`${getTopic(rule.topic_id)?.title ?? rule.topic_id} · ${kindLabel(rule.kind)}`}
                </p>
                {/* Names the rule, because the visible label repeats down the list. */}
                <button
                  aria-label={`${rule.is_starred ? 'ביטול סימון' : 'סימון'}: ${rule.text}`}
                  aria-pressed={rule.is_starred}
                  className="admin-row__star"
                  disabled={savingIds.has(rule.id)}
                  onClick={() => void toggleStar(rule)}
                  type="button"
                >
                  {rule.is_starred ? '★' : '☆'}
                </button>
              </li>
            ))}
          </ol>

          <div className="admin-paging">
            <button
              disabled={cursorStack.length === 1}
              onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
              type="button"
            >
              הקודם
            </button>
            <button
              disabled={!result.nextCursor}
              onClick={() => setCursorStack((stack) => [...stack, result.nextCursor])}
              type="button"
            >
              הבא
            </button>
          </div>
        </>
      )}
    </section>
    </div>
  )
}
