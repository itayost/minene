'use client'

import { useMemo, useState, type FormEvent } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { DocumentsList } from '../../../../../src/brain/DocumentsList'
import { createDocumentsApi, type DocumentsClient } from '../../../../../src/brain/documents-api'
import { ExternalHunt } from '../../../../../src/brain/ExternalHunt'
import { createRulesApi, type RulesClient } from '../../../../../src/brain/rules-api'
import { RULE_TOPICS } from '../../../../../src/brain/topics'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'

/**
 * A scanned safety manual or opening-procedure binder is the realistic upper
 * bound for what an owner uploads here: generous enough for a real multi-page
 * manual, small enough to fail fast in the browser instead of sitting
 * "uploading" for minutes only for the server to reject it anyway.
 */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

const isPdfFile = (file: File) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name)

function validateFile(file: File | null): string {
  if (!file) return 'יש לבחור קובץ PDF להעלאה.'
  if (!isPdfFile(file)) return 'ניתן להעלות קבצי PDF בלבד.'
  if (file.size > MAX_UPLOAD_BYTES) {
    return `הקובץ גדול מדי. הגודל המרבי הוא ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`
  }
  return ''
}

type Outcome =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'processing' }
  | { phase: 'ready'; ruleCount: number }
  | { phase: 'readyEmpty' }
  | { phase: 'failed'; message: string }

const FIRST_TOPIC_ID = RULE_TOPICS[0]?.id ?? 'live'

/**
 * Two ways in, one pipeline. A pasted thread and an uploaded PDF differ only in
 * where the text comes from: both become a documents row, both go through
 * extract-rules, both land in the same approval lobby.
 *
 * So this is a mode switch inside one form rather than a second page. A second
 * page would have duplicated the topic picker, the five status messages, the
 * auth handling and the list refresh, and the copies would have drifted.
 */
const MODES = [
  { id: 'pdf', label: 'קובץ PDF' },
  { id: 'conversation', label: 'שיחה' },
] as const

type Mode = (typeof MODES)[number]['id']

export function ExtractClient({ tenantId }: { tenantId: string }) {
  const documentsApi = useMemo(
    () => createDocumentsApi(createBrowserSupabase() as unknown as DocumentsClient),
    [],
  )
  const handleError = useApiErrorHandler()

  const rulesApi = useMemo(
    () => createRulesApi(createBrowserSupabase() as unknown as RulesClient),
    [],
  )

  const [topicId, setTopicId] = useState(FIRST_TOPIC_ID)
  const [mode, setMode] = useState<Mode>('pdf')
  const [conversation, setConversation] = useState({ title: '', text: '' })
  const [file, setFile] = useState<File | null>(null)
  const [validationError, setValidationError] = useState('')
  const [outcome, setOutcome] = useState<Outcome>({ phase: 'idle' })
  // Bumped once per submit, after upload and extraction settle either way, so
  // the list refetches and the document just watched succeed or fail shows up
  // there too. Without it the list would only ever reflect what existed at mount.
  const [documentsVersion, setDocumentsVersion] = useState(0)

  const isBusy = outcome.phase === 'uploading' || outcome.phase === 'processing'
  const isConversation = mode === 'conversation'

  const switchMode = (next: Mode) => {
    setMode(next)
    // Both sources are cleared on a switch, not only the one being left. A
    // half-filled form from the other mode is invisible once its input is
    // unmounted, and submitting it would use a source nobody can still see.
    setFile(null)
    setConversation({ title: '', text: '' })
    setValidationError('')
    setOutcome({ phase: 'idle' })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const invalid = isConversation
      ? (conversation.text.trim() ? '' : 'יש להדביק את תוכן השיחה.')
      : validateFile(file)
    if (invalid || (!isConversation && !file)) {
      setValidationError(invalid)
      return
    }
    setValidationError('')
    // "uploading" for a paste too. There is no transfer, but the phase means
    // "creating the document" to everything downstream, and the message it
    // drives says so in words rather than naming one.
    setOutcome({ phase: 'uploading' })

    let documentId: string
    try {
      // Step order is deliberate: upload to storage, then insert the row, then
      // invoke extraction. uploadDocument enforces upload-before-insert; this
      // component owns the next link, never calling extractRules unless the
      // upload actually succeeded. A paste has no first step to fail.
      const saved = isConversation
        ? await documentsApi.saveConversation({
          tenantId, topicId, title: conversation.title, text: conversation.text,
        })
        : await documentsApi.uploadDocument({ file: file as File, tenantId, topicId })
      documentId = saved.documentId
    } catch (uploadFailure) {
      // No row was created either way, so there is nothing new for the list.
      const message = handleError(uploadFailure)
      if (message) setOutcome({ phase: 'failed', message })
      return
    }

    setOutcome({ phase: 'processing' })

    try {
      const result = await documentsApi.extractRules(documentId) as { rules?: unknown[] } | null
      const ruleCount = result?.rules?.length ?? 0
      // A document can succeed and yield nothing rule-like. That is a deliberate
      // success case, not a failure: reporting only "ready" would leave the
      // owner staring at an empty lobby with no explanation.
      setOutcome(ruleCount === 0 ? { phase: 'readyEmpty' } : { phase: 'ready', ruleCount })
      setDocumentsVersion((current) => current + 1)
    } catch (extractionFailure) {
      const message = handleError(extractionFailure)
      if (message) setOutcome({ phase: 'failed', message })
      // Unlike a failed upload, the row itself was created with a reason, which
      // is worth surfacing in the list.
      setDocumentsVersion((current) => current + 1)
    }
  }

  return (
    <div className="brain-surface">
      <section className="upload-page" aria-label="העלאת מסמך לחילוץ חוקים" dir="rtl">
        <h2>העלאת מסמך</h2>
        <p className="upload-page__intro">
          בחרי נושא, והעלי קובץ PDF או הדביקי שיחה, כדי לחלץ מהם חוקים לבדיקה בלובי האישור.
        </p>

        <div aria-label="מקור החילוץ" className="upload-page__modes" role="tablist">
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
          <label htmlFor="upload-topic">נושא המסמך</label>
          <select
            disabled={isBusy}
            id="upload-topic"
            onChange={(event) => setTopicId(event.target.value)}
            value={topicId}
          >
            {RULE_TOPICS.map((topic) => (
              <option key={topic.id} value={topic.id}>{topic.title}</option>
            ))}
          </select>

          {isConversation ? (
            <>
              <label htmlFor="conversation-title">כותרת (לא חובה)</label>
              <input
                disabled={isBusy}
                id="conversation-title"
                maxLength={80}
                onChange={(event) => {
                  setConversation((current) => ({ ...current, title: event.target.value }))
                  setValidationError('')
                }}
                placeholder="לדוגמה: החזרות בלי חשבונית"
                type="text"
                value={conversation.title}
              />

              <label htmlFor="conversation-text">תוכן השיחה</label>
              <textarea
                disabled={isBusy}
                id="conversation-text"
                onChange={(event) => {
                  setConversation((current) => ({ ...current, text: event.target.value }))
                  setValidationError('')
                  setOutcome({ phase: 'idle' })
                }}
                rows={8}
                value={conversation.text}
              />
            </>
          ) : (
            <>
              <label htmlFor="upload-file">קובץ PDF</label>
              <input
                accept="application/pdf"
                disabled={isBusy}
                id="upload-file"
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

          <button disabled={isBusy} type="submit">העלאה וחילוץ</button>
        </form>

        {outcome.phase === 'uploading' ? (
          <p className="upload-page__status" role="status">
            {isConversation ? 'שומרת את השיחה…' : 'מעלה את הקובץ…'}
          </p>
        ) : null}
        {outcome.phase === 'processing' ? (
          <p className="upload-page__status" role="status">מעבד את המסמך ומחלץ ממנו חוקים…</p>
        ) : null}
        {outcome.phase === 'ready' ? (
          <p className="upload-page__status" role="status">
            {`המסמך עובד בהצלחה. נמצאו ${outcome.ruleCount} חוקים חדשים, הממתינים לאישור בלובי.`}
          </p>
        ) : null}
        {outcome.phase === 'readyEmpty' ? (
          <p className="upload-page__status" role="status">
            {isConversation
              ? 'השיחה עובדה בהצלחה, אך לא נמצאו בה חוקים. אפשר לנסות שיחה אחרת.'
              : 'המסמך עובד בהצלחה, אך לא נמצאו בו חוקים. אפשר לנסות מסמך אחר.'}
          </p>
        ) : null}
        {outcome.phase === 'failed' ? (
          <p className="upload-page__error" role="alert">{outcome.message}</p>
        ) : null}
      </section>

      {/* Its own section rather than a third mode on the form above, which is
          entirely about creating a document. This path creates none: there is
          nothing to name, nothing to store, and nothing to appear in the list
          below. It keeps its own topic for the same reason. */}
      <ExternalHunt rulesApi={rulesApi} />

      {/* A sibling section, not nested inside .upload-page: it keeps the two
          landmarks flat and keeps each one's role="status" and role="alert"
          nodes independently queryable. */}
      <DocumentsList
        documentsApi={documentsApi}
        onError={handleError}
        reloadToken={documentsVersion}
      />
    </div>
  )
}
