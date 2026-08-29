'use client'

import { useEffect, useState } from 'react'
import type { DocumentsApi } from './documents-api'
import { getTopic } from './topics'
import type { BrainDocument, DocumentSourceType, DocumentStatus } from './types'

const STATUS_LABEL: Record<DocumentStatus, string> = {
  processing: 'בעיבוד',
  ready: 'מוכן',
  failed: 'נכשל',
}

/**
 * Before conversations existed every row here was a PDF and this column would
 * have been noise. Now the list holds two kinds of thing, and a titled paste is
 * indistinguishable from an uploaded file by its name alone.
 */
const SOURCE_LABEL: Record<DocumentSourceType, string> = {
  pdf: 'קובץ',
  conversation: 'שיחה',
}

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; rows: BrainDocument[]; hasMore: boolean }
  | { status: 'error'; message: string }

export function DocumentsList({
  documentsApi,
  onError,
  reloadToken,
}: {
  documentsApi: DocumentsApi
  /** Returns a message to display, or null when it has already redirected. */
  onError: (error: unknown) => string | null
  reloadToken: number
}) {
  const [state, setState] = useState<ListState>({ status: 'loading' })

  // `reloadToken` is a trigger, not a read. A reload token that no longer causes
  // a reload is a silent bug, which is what dropping it from the list would be.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger dependency
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    documentsApi
      .listRecentDocuments()
      .then(({ rows, hasMore }) => {
        if (!cancelled) setState({ status: 'ready', rows, hasMore })
      })
      .catch((error: unknown) => {
        const message = onError(error)
        if (!cancelled && message) setState({ status: 'error', message })
      })

    return () => {
      cancelled = true
    }
  }, [documentsApi, onError, reloadToken])

  if (state.status === 'error') {
    return (
      <section className="documents-list" aria-label="מסמכים שהועלו לאחרונה" dir="rtl">
        <h2>מסמכים שהועלו לאחרונה</h2>
        <p className="documents-list__error" role="alert">
          {state.message}
        </p>
      </section>
    )
  }

  const rows = state.status === 'ready' ? state.rows : []

  return (
    <section className="documents-list" aria-label="מסמכים שהועלו לאחרונה" dir="rtl">
      <h2>מסמכים שהועלו לאחרונה</h2>

      <p className="documents-list__status" role="status">
        {state.status === 'loading' ? 'טוענת מסמכים' : `${rows.length} מסמכים אחרונים`}
      </p>

      {state.status === 'ready' && rows.length === 0 ? (
        <p className="documents-list__empty">עדיין לא הועלו מסמכים.</p>
      ) : null}

      <ol className="documents-list__list">
        {rows.map((doc) => (
          <li className="documents-list__row" key={doc.id}>
            <p className="documents-list__filename">{doc.filename}</p>
            <dl className="documents-list__meta">
              <div>
                <dt>נושא</dt>
                <dd>{getTopic(doc.topic_id)?.title ?? doc.topic_id}</dd>
              </div>
              <div>
                <dt>מקור</dt>
                <dd>{SOURCE_LABEL[doc.source_type] ?? doc.source_type}</dd>
              </div>
              <div>
                <dt>סטטוס</dt>
                <dd>{STATUS_LABEL[doc.status] ?? doc.status}</dd>
              </div>
            </dl>
            {doc.error ? (
              <p className="documents-list__row-error" role="alert">
                {doc.error}
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {/* The cap is never silent: an owner who cannot find an older upload needs
          to know the list stopped, not wonder whether it disappeared. */}
      {state.status === 'ready' && state.hasMore ? (
        <p className="documents-list__more">
          {`מוצגים ${rows.length} המסמכים האחרונים בלבד. יש מסמכים נוספים שאינם מופיעים ברשימה.`}
        </p>
      ) : null}
    </section>
  )
}
