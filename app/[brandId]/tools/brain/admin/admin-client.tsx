'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { KpiCards, type KpiState } from '../../../../../src/brain/KpiCards'
import { createPeopleApi, type PeopleClient } from '../../../../../src/brain/people-api'
import { PeopleManager } from '../../../../../src/brain/PeopleManager'
import { createRolesApi, type RolesClient } from '../../../../../src/brain/roles-api'
import { RolesManager } from '../../../../../src/brain/RolesManager'
import { createRulesApi, type RulesClient } from '../../../../../src/brain/rules-api'
import { getTopic, RULE_TOPICS } from '../../../../../src/brain/topics'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import type { Rule, RuleCursor, RuleKind, RulePolarity } from '../../../../../src/brain/types'

type Filters = { query: string; kind: RuleKind | null }

const INITIAL_FILTERS: Filters = { query: '', kind: null }

/** null means every topic, which list_rules reads as no filter. */
const TABS: readonly { id: string | null; title: string }[] = [
  { id: null, title: 'הכל' },
  ...RULE_TOPICS.map((topic) => ({ id: topic.id, title: topic.title })),
]

/**
 * `kind` has no database default and was nullable until a rule was classified,
 * so an unclassified row must not render as a blank badge: that reads as a bug
 * rather than as "not yet classified". `tip` is the historical default, since
 * every rule was outcome-framed advice before this classification existed.
 *
 * `case` is deliberately NOT part of that fallback. A case is the only kind
 * carrying a `response`, so mistaking an unclassified row for one would render
 * an answer under a situation that has none. Only an explicit 'case' reads as a
 * case.
 */
const KIND_LABELS: Record<RuleKind, string> = { tip: 'טיפ', process: 'תהליך', case: 'מקרה' }
const normalizeKind = (kind: RuleKind): RuleKind => (KIND_LABELS[kind] ? kind : 'tip')

const POLARITY_LABELS: Record<RulePolarity, string> = { do: 'עשה', dont: 'אל תעשה' }

/**
 * like_pct is null until somebody votes, and null is not 0: rendering an unrated
 * rule as "0%" would claim every reader disliked it, which is the opposite of
 * what no data means. The two render differently and the accessible name says
 * which one this is.
 *
 * The denominator sits beside the percentage rather than inside a tooltip. "80%"
 * off five votes and "80%" off fifty support very different decisions, and the
 * whole point of measuring this was to stop guessing.
 */
function LikeCell({ likePct, voteCount }: { likePct: number | null; voteCount: number }) {
  if (likePct == null) return <span className="admin-like admin-like--unrated">טרם דורג</span>

  const tone = likePct >= 70 ? 'high' : likePct >= 40 ? 'mid' : 'low'
  return (
    <span
      aria-label={`${likePct} אחוז לייקים מתוך ${voteCount} מצביעים`}
      className="admin-like"
      data-tone={tone}
    >
      <span aria-hidden="true" className="admin-like__pct">{likePct}%</span>
      <span aria-hidden="true" className="admin-like__count">{voteCount}</span>
    </span>
  )
}

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
  const rolesApi = useMemo(
    () => createRolesApi(createBrowserSupabase() as unknown as RolesClient),
    [],
  )
  const peopleApi = useMemo(
    () => createPeopleApi(createBrowserSupabase() as unknown as PeopleClient),
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
  const hiddenFilterCount = filters.kind ? 1 : 0

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

      {/* Above the ribbon rather than below the list: the role catalogue is what
          the rules beneath it are classified against, and the people list is
          what makes that classification reach anyone. Both are collapsed, so
          they cost one line each until an owner needs them. */}
      <RolesManager rolesApi={rolesApi} />
      <PeopleManager peopleApi={peopleApi} rolesApi={rolesApi} />

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

          <label htmlFor="admin-kind">סוג</label>
          <select
            id="admin-kind"
            onChange={(event) => applyFilters({ kind: (event.target.value || null) as RuleKind | null })}
            value={filters.kind ?? ''}
          >
            <option value="">הכל</option>
            <option value="tip">טיפ</option>
            <option value="process">תהליך</option>
            <option value="case">מקרה</option>
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
            {result.rows.map((rule) => {
              const kind = normalizeKind(rule.kind)
              return (
              <li className="admin-row" key={rule.id}>
                <p className="admin-row__head">
                  <span className="admin-row__number">{`#${rule.rule_number}`}</span>
                  <span className="admin-row__topic">{getTopic(rule.topic_id)?.title ?? rule.topic_id}</span>
                  {/* An em dash, not an empty span: unfiled is a normal state for
                      every rule that predates the column. */}
                  <span className="admin-row__sub-topic">{rule.sub_topic ?? '—'}</span>
                  <LikeCell likePct={rule.like_pct} voteCount={rule.vote_count} />
                </p>
                <p className="admin-row__text">{rule.text}</p>
                {/* A case is a situation plus what to do about it. Showing only
                    `text` would print the incident and withhold the answer,
                    which is the half that makes it useful. */}
                {kind === 'case' && rule.response ? (
                  <p className="admin-row__response">
                    <span className="admin-row__response-label">תגובה:</span> {rule.response}
                  </p>
                ) : null}
                <p className="admin-row__meta">
                  <span className="admin-kind-badge" data-kind={kind}>{KIND_LABELS[kind]}</span>
                  {rule.polarity ? (
                    <span className="admin-polarity-badge" data-polarity={rule.polarity}>
                      {POLARITY_LABELS[rule.polarity]}
                    </span>
                  ) : null}
                </p>
              </li>
              )
            })}
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
