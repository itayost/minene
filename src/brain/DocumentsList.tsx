'use client'

import { useEffect, useState } from 'react'
import type { DocumentsApi } from './documents-api'
import { getTopic } from './topics'
import type { BrainDocument, DocumentStatus } from './types'

const STATUS_LABEL: Record<DocumentStatus, string> = {
  processing: 'בעיבוד',
  ready: 'מוכן',
  failed: 'נכשל',
}

type ListState =
  | { status: 'loading' }
  | { status: 'ready'; rows: BrainDocument[]; hasMore: boolean }
  | { status: 'error'; message: string }

export function DocumentsList({ documentsApi, onError, reloadToken }: {
  documentsApi: DocumentsApi
  /** Returns a message to display, or null when it has already redirected. */
  onError: (error: unknown) => string | null
  reloadToken: number
}) {
  const [state, setState] = useState<ListState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    documentsApi.listRecentDocuments()
      .then(({ rows, hasMore }) => {
        if (!cancelled) setState({ status: 'ready', rows, hasMore })
      })
      .catch((error: unknown) => {
        const message = onError(error)
        if (!cancelled && message) setState({ status: 'error', message })
      })

    return () => { cancelled = true }
  }, [documentsApi, onError, reloadToken])

  if (state.status === 'error') {
    return (
      <section className="documents-list" aria-label="מסמכים שהועלו לאחרונה" dir="rtl">
        <h2>מסמכים שהועלו לאחרונה</h2>
        <p className="documents-list__error" role="alert">{state.message}</p>
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
                <dt>סטטוס</dt>
                <dd>{STATUS_LABEL[doc.status] ?? doc.status}</dd>
              </div>
            </dl>
            {doc.error ? <p className="documents-list__row-error" role="alert">{doc.error}</p> : null}
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
