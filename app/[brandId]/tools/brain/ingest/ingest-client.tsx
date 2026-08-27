'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { DocumentsList } from '../../../../../src/brain/DocumentsList'
import { createDocumentsApi, type DocumentsClient } from '../../../../../src/brain/documents-api'
import { KpiCards, type KpiState } from '../../../../../src/brain/KpiCards'
import { createRolesApi, type RolesClient } from '../../../../../src/brain/roles-api'
import { RuleEditSheet, type RuleDraft } from '../../../../../src/brain/RuleEditSheet'
import { createRulesApi, type RulesApi, type RulesClient } from '../../../../../src/brain/rules-api'
import { getTopic, RULE_TOPICS } from '../../../../../src/brain/topics'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import type { Role, Rule, RuleKind } from '../../../../../src/brain/types'

const FIRST_TOPIC_ID = RULE_TOPICS[0]?.id ?? 'live'
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/**
 * Three ways in, one pipeline, one topic picker.
 *
 * A PDF, a pasted thread and a web search differ only in where the text comes
 * from. The first two already became one documents row; the hunt used to sit in
 * its own section below, carrying a duplicate topic select, because it is the
 * one path that creates no document. That asymmetry is real and is handled by
 * the documents list staying empty for it -- it does not justify a second copy
 * of the same control.
 */
const MODES = [
  { id: 'pdf', label: 'קובץ PDF' },
  { id: 'conversation', label: 'שיחה' },
  { id: 'hunt', label: 'חיפוש ברשת' },
] as const

type Mode = (typeof MODES)[number]['id']

type Outcome =
  | { phase: 'idle' }
  | { phase: 'working' }
  | { phase: 'processing' }
  | { phase: 'ready'; ruleCount: number }
  | { phase: 'readyEmpty' }
  | { phase: 'failed'; message: string }

const KIND_LABELS: Record<RuleKind, string> = { tip: 'טיפ', process: 'תהליך', case: 'מקרה' }
const kindLabel = (kind: RuleKind) => KIND_LABELS[kind] ?? 'טיפ'
const sourceLabel = (source: string) => (
  source === 'pdf' ? 'מתוך מסמך'
    : source === 'conversation' ? 'מתוך שיחה'
      : source === 'external' ? 'מהרשת'
        : source === 'internal' ? 'הוגש בידי חבר צוות'
          : 'נוצר אוטומטית'
)

/**
 * How many pages of the queue to pull before stopping.
 *
 * This is a drainable queue, not an archive. Unbounded, a tenant with 600
 * pending rules issued thirteen sequential RPCs on mount and again after every
 * upload -- and then fed every id into one in(...) filter, whose URL a proxy
 * refuses long before that, which lands in the same failure path that used to
 * wipe a rule's roles.
 */
const MAX_QUEUE_PAGES = 4

const isPdf = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

/** Rounded to one decimal, because a PDF's size is a rough reassurance. */
const readableSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)}MB`

/**
 * Pages list_pending_rules, oldest first and tenant-wide, up to a cap.
 *
 * `hasMore` is returned rather than swallowed: a cap that is not said out loud
 * reads as "this is the whole queue", and an owner who cannot find a rule they
 * know is pending would have no way to tell which it was.
 */
export async function loadAllPending(rulesApi: RulesApi): Promise<{ rows: Rule[]; hasMore: boolean }> {
  const rows: Rule[] = []
  let cursor = null
  let pages = 0

  do {
    const page = await rulesApi.listPendingRules({ cursor })
    rows.push(...page.rows)
    cursor = page.nextCursor
    pages += 1
  } while (cursor && pages < MAX_QUEUE_PAGES)

  return { rows, hasMore: Boolean(cursor) }
}

export function IngestClient({ tenantId }: { tenantId: string }) {
  const documentsApi = useMemo(() => createDocumentsApi(createBrowserSupabase() as unknown as DocumentsClient), [])
  const rulesApi = useMemo(() => createRulesApi(createBrowserSupabase() as unknown as RulesClient), [])
  const rolesApi = useMemo(() => createRolesApi(createBrowserSupabase() as unknown as RolesClient), [])
  const handleError = useApiErrorHandler()

  const [topicId, setTopicId] = useState(FIRST_TOPIC_ID)
  const [mode, setMode] = useState<Mode>('pdf')
  const [file, setFile] = useState<File | null>(null)
  const [conversation, setConversation] = useState({ title: '', text: '' })
  const [subTopic, setSubTopic] = useState('')
  const [validationError, setValidationError] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ phase: 'idle' })
  const [documentsVersion, setDocumentsVersion] = useState(0)

  const [queue, setQueue] = useState<Rule[]>([])
  const [queueError, setQueueError] = useState('')
  const [queueHasMore, setQueueHasMore] = useState(false)
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  const [editError, setEditError] = useState('')
  const [roles, setRoles] = useState<Role[]>([])
  const [ruleRoles, setRuleRoles] = useState<ReadonlyMap<string, string[]>>(() => new Map())
  /**
   * Whether the role catalogue actually arrived. setRuleRoles REPLACES, so
   * without this a failed roles request means every save writes an empty set
   * and permanently deletes a rule's targeting -- while the sheet, which hides
   * the fieldset when there are no roles, shows nothing to suggest it.
   */
  const [rolesLoaded, setRolesLoaded] = useState(false)
  const [kpiState, setKpiState] = useState<KpiState>({ status: 'loading' })

  const isBusy = outcome.phase === 'working' || outcome.phase === 'processing'
  const isHunt = mode === 'hunt'
  const isConversation = mode === 'conversation'

  const loadQueue = useCallback(async () => {
    try {
      const { rows, hasMore } = await loadAllPending(rulesApi)
      setQueue(rows)
      setQueueHasMore(hasMore)
      try {
        const [catalogue, assigned] = await Promise.all([
          rolesApi.listRoles(),
          rolesApi.listRuleRoles({ ruleIds: rows.map((rule) => rule.id) }),
        ])
        setRoles(catalogue)
        setRuleRoles(assigned)
        setRolesLoaded(true)
      } catch (rolesFailure) {
        setRolesLoaded(false)
        // A failed role list must not blank the queue. The sheet degrades to
        // editing every axis except who a rule addresses.
        handleError(rolesFailure)
      }
    } catch (error) {
      if (handleError(error)) setQueueError('לא הצלחנו לטעון את החוקים הממתינים לאישור')
    }
  }, [handleError, rolesApi, rulesApi])

  useEffect(() => { void loadQueue() }, [loadQueue])

  useEffect(() => {
    let cancelled = false
    rulesApi.loadKpis()
      .then((kpis) => { if (!cancelled) setKpiState({ status: 'ready', ...kpis }) })
      // A KPI failure must never blank the form or the queue beneath it.
      .catch(() => { if (!cancelled) setKpiState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [rulesApi])

  const switchMode = (next: Mode) => {
    setMode(next)
    // Every source is cleared, not only the one being left: a half-filled form
    // from another mode is invisible once its input unmounts, and submitting it
    // would use a source nobody can still see.
    setFile(null)
    setConversation({ title: '', text: '' })
    setSubTopic('')
    setValidationError('')
    setOutcome({ phase: 'idle' })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (isHunt) {
      setOutcome({ phase: 'processing' })
      try {
        const result = await rulesApi.huntExternal({ topicId, subTopic: subTopic.trim() || null }) as
          { rules?: unknown[] } | null
        const ruleCount = result?.rules?.length ?? 0
        setOutcome(ruleCount === 0 ? { phase: 'readyEmpty' } : { phase: 'ready', ruleCount })
        await loadQueue()
      } catch (failure) {
        if (handleError(failure)) setOutcome({ phase: 'failed', message: 'החיפוש נכשל. נסי שוב מאוחר יותר.' })
      }
      return
    }

    const invalid = isConversation
      ? (conversation.text.trim() ? '' : 'יש להדביק את תוכן השיחה.')
      : !file ? 'יש לבחור קובץ PDF להעלאה.'
        : !isPdf(file) ? 'ניתן להעלות קבצי PDF בלבד.'
          : file.size > MAX_UPLOAD_BYTES ? `הקובץ גדול מדי. הגודל המרבי הוא ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.` : ''
    if (invalid) {
      setValidationError(invalid)
      return
    }
    setValidationError('')
    setOutcome({ phase: 'working' })

    let documentId: string
    try {
      const saved = isConversation
        ? await documentsApi.saveConversation({ tenantId, topicId, title: conversation.title, text: conversation.text })
        : await documentsApi.uploadDocument({ file: file as File, tenantId, topicId })
      documentId = saved.documentId
    } catch (failure) {
      const message = handleError(failure)
      if (message) setOutcome({ phase: 'failed', message })
      return
    }

    setOutcome({ phase: 'processing' })
    try {
      const result = await documentsApi.extractRules(documentId) as { rules?: unknown[] } | null
      const ruleCount = result?.rules?.length ?? 0
      setOutcome(ruleCount === 0 ? { phase: 'readyEmpty' } : { phase: 'ready', ruleCount })
    } catch (failure) {
      const message = handleError(failure)
      if (message) setOutcome({ phase: 'failed', message })
    }
    setDocumentsVersion((current) => current + 1)
    // The whole point of this screen: what the upload produced appears below it.
    await loadQueue()
  }

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

  const decide = async (rule: Rule, decision: 'approved' | 'rejected') => {
    setQueueError('')
    await withSaving(rule.id, async () => {
      try {
        if (decision === 'approved') await rulesApi.approveRule(rule.id)
        else await rulesApi.rejectRule(rule.id)
        setQueue((current) => current.filter((row) => row.id !== rule.id))
      } catch (error) {
        if (handleError(error)) {
          setQueueError(decision === 'approved' ? 'לא הצלחנו לאשר את החוק. נסי שוב.' : 'לא הצלחנו לדחות את החוק. נסי שוב.')
        }
      }
    })
  }

  const saveDraft = async () => {
    if (!draft) return
    if (!draft.text.trim()) {
      setEditError('לא ניתן לשמור חוק ריק')
      return
    }
    if (draft.kind === 'case' && !draft.response.trim()) {
      setEditError('למקרה צריך גם תגובה: מה עושים כשזה קורה.')
      return
    }
    setEditError('')

    await withSaving(draft.ruleId, async () => {
      try {
        const saved = await rulesApi.updateRule({
          ruleId: draft.ruleId,
          text: draft.text,
          kind: draft.kind,
          topicId: draft.topicId,
          subTopic: draft.subTopic.trim() || null,
          polarity: draft.polarity || null,
          response: draft.kind === 'case' ? draft.response.trim() : null,
        })
        // Only when the catalogue is known. Writing an empty set derived from a
        // failed fetch is indistinguishable, at the database, from a reviewer
        // deliberately clearing every role.
        if (rolesLoaded) {
          await rolesApi.setRuleRoles({ ruleId: draft.ruleId, roleIds: draft.roleIds })
          setRuleRoles((current) => new Map(current).set(draft.ruleId, [...draft.roleIds]))
        }
        setQueue((current) => current.map((row) => (row.id === saved.id ? saved : row)))
        setDraft(null)
      } catch (error) {
        if (handleError(error)) setEditError('לא הצלחנו לשמור את החוק. נסי שוב.')
      }
    })
  }

  return (
    <div className="brain-surface">
      <section aria-label="הזנת ידע למוח הארגוני" className="upload-page" dir="rtl">
        <h2>הזנת ידע</h2>

        {/* At the top of the screen you feed from: "135 פריטי ידע, גידול שבועי"
            is feedback on the act of feeding, not a separate report. */}
        <KpiCards state={kpiState} />

        <div aria-label="מקור הידע" className="upload-page__modes" role="tablist">
          {MODES.map((item) => (
            <button
              aria-selected={mode === item.id}
              className="upload-page__mode"
              disabled={isBusy}
              key={item.id}
              onClick={() => switchMode(item.id)}
              role="tab"
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <form className="upload-page__form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="ingest-topic">נושא</label>
          <select
            disabled={isBusy}
            id="ingest-topic"
            onChange={(event) => setTopicId(event.target.value)}
            value={topicId}
          >
            {RULE_TOPICS.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
          </select>

          {isHunt ? (
            <>
              <label htmlFor="ingest-sub-topic">תת־נושא (לא חובה)</label>
              <input
                disabled={isBusy}
                id="ingest-sub-topic"
                maxLength={60}
                onChange={(event) => setSubTopic(event.target.value)}
                placeholder="לדוגמה: אזור הקופה"
                type="text"
                value={subTopic}
              />
            </>
          ) : isConversation ? (
            <>
              <label htmlFor="ingest-title">כותרת (לא חובה)</label>
              <input
                disabled={isBusy}
                id="ingest-title"
                maxLength={80}
                onChange={(event) => setConversation((c) => ({ ...c, title: event.target.value }))}
                placeholder="לדוגמה: החזרות בלי חשבונית"
                type="text"
                value={conversation.title}
              />
              <label htmlFor="ingest-text">תוכן השיחה</label>
              <textarea
                disabled={isBusy}
                id="ingest-text"
                onChange={(event) => {
                  setConversation((c) => ({ ...c, text: event.target.value }))
                  setValidationError('')
                }}
                rows={8}
                value={conversation.text}
              />
            </>
          ) : (
            <>
              {/* The label IS the control. A bare file input renders the
                  browser's own widget, which is locale-bound: on an
                  English-locale Chrome this screen said "Choose File / No file
                  chosen" in the middle of an RTL Hebrew page, and no styling
                  reaches inside it.

                  The input is clipped rather than display:none, which would
                  take it out of the tab order and leave a control only a mouse
                  can operate. htmlFor keeps the accessible name on the input
                  itself, so it is still what a screen reader announces. */}
              <label className="file-drop" htmlFor="ingest-file">
                <span className="file-drop__action">בחרי קובץ PDF</span>
                {/* A real space, not styling. The two spans are separate visual
                    lines, so the gap looked right while textContent -- which is
                    what the accessible name is computed from -- concatenated
                    them into "PDFלא". Whitespace-only text does not become a
                    grid item, so nothing moves. */}
                {' '}
                <span className="file-drop__state">
                  {file ? `${file.name} · ${readableSize(file.size)}` : 'לא נבחר קובץ'}
                </span>
              </label>
              <input
                accept="application/pdf"
                className="file-drop__input"
                disabled={isBusy}
                id="ingest-file"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null)
                  setValidationError('')
                  setOutcome({ phase: 'idle' })
                }}
                type="file"
              />
            </>
          )}

          {validationError ? <p className="upload-page__error" role="alert">{validationError}</p> : null}

          <button disabled={isBusy} type="submit">{isHunt ? 'חיפוש ברשת' : 'העלאה וחילוץ'}</button>
        </form>

        {outcome.phase === 'working' ? (
          <p className="upload-page__status" role="status">
            {isConversation ? 'שומרת את השיחה…' : 'מעלה את הקובץ…'}
          </p>
        ) : null}
        {outcome.phase === 'processing' ? (
          <p className="upload-page__status" role="status">
            {isHunt ? 'מחפשת ברשת… זה עשוי לקחת כמה שניות.' : 'מעבד ומחלץ חוקים…'}
          </p>
        ) : null}
        {outcome.phase === 'ready' ? (
          <p className="upload-page__status" role="status">
            {`נמצאו ${outcome.ruleCount} חוקים חדשים. הם מופיעים למטה, ממתינים לאישור.`}
          </p>
        ) : null}
        {/* Zero is a success with nothing to add, and it says why: "לא נמצא
            כלום" reads as a broken search when almost always everything found
            was already here. */}
        {outcome.phase === 'readyEmpty' ? (
          <p className="upload-page__status" role="status">
            {isHunt
              ? 'לא נמצאו המלצות חדשות. ייתכן שכל מה שנמצא כבר קיים אצלך.'
              : 'העיבוד הסתיים, אך לא נמצאו חוקים. אפשר לנסות מקור אחר.'}
          </p>
        ) : null}
        {outcome.phase === 'failed' ? (
          <p className="upload-page__error" role="alert">{outcome.message}</p>
        ) : null}
      </section>

      <section aria-label="חוקים הממתינים לאישור" className="approval-lobby" dir="rtl">
        <h2>ממתינים לאישור</h2>
        <p className="approval-lobby__count" role="status">{`${queue.length} חוקים ממתינים`}</p>
        {queueError ? <p className="approval-lobby__error" role="alert">{queueError}</p> : null}
        {queue.length === 0 ? <p className="approval-lobby__empty">אין כרגע חוקים הממתינים לאישור.</p> : null}
        {/* Never a silent cap: an owner who cannot find a rule they know is
            pending needs to be told the list stopped, not left to wonder. */}
        {queueHasMore ? (
          <p className="approval-lobby__intro">
            {`מוצגים ${queue.length} הישנים ביותר. יש עוד ממתינים — אשרי או דחי כדי להגיע אליהם.`}
          </p>
        ) : null}

        <ol className="approval-lobby__list">
          {queue.map((rule) => {
            const isSaving = savingIds.has(rule.id)
            return (
              <li className="brain-card" key={rule.id}>
                <p className="approval-lobby__text">{rule.text}</p>
                <p className="brain-card__meta">
                  {`${getTopic(rule.topic_id)?.title ?? rule.topic_id} · ${kindLabel(rule.kind)} · ${sourceLabel(rule.source)}`}
                </p>
                {/* One filled action. The labels repeat down the list, so each
                    names its rule -- without that a screen-reader user cannot
                    tell which row a button belongs to. */}
                <div className="brain-card__actions">
                  <button
                    aria-label={`אישור: ${rule.text}`}
                    data-weight="primary"
                    disabled={isSaving}
                    onClick={() => void decide(rule, 'approved')}
                    type="button"
                  >
                    אישור
                  </button>
                  <button
                    aria-label={`עריכה: ${rule.text}`}
                    data-weight="quiet"
                    disabled={isSaving}
                    onClick={() => {
                      setEditError('')
                      setDraft({
                        ruleId: rule.id,
                        text: rule.text,
                        kind: rule.kind,
                        topicId: rule.topic_id,
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
                  <button
                    aria-label={`דחייה: ${rule.text}`}
                    data-weight="quiet"
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
      </section>

      <DocumentsList documentsApi={documentsApi} onError={handleError} reloadToken={documentsVersion} />

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
    </div>
  )
}
