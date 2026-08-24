'use client'

import { useState } from 'react'

/* Inline, like BrandShell's own icons: three glyphs are not worth a dependency. */
const plusIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 6v12M6 12h12" />
  </svg>
)

const micIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

const liveIcon = (
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <rect x="2" y="7" width="13" height="10" rx="2.5" />
    <path d="m15 11 6-3.5v9L15 13z" />
  </svg>
)

const NOT_CONNECTED = 'המנטור עדיין לא מחובר. הכפתורים כאן כדי להראות את הצורה.'

/**
 * The composer for talking to the mentor: attach, type, speak, or open a live
 * avatar call.
 *
 * No visible heading by design: aria-label is what names the composer, and
 * without it the bar would be four unlabelled controls to anyone not looking at
 * the screen.
 *
 * None of it is wired to anything. Pressing a control says so rather than doing
 * nothing, because a button that silently ignores you reads as broken, and one
 * that pretends to work is worse.
 */
export function MentorBar() {
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')

  return (
    <section aria-label="דברו עם המנטור" className="mentor" dir="rtl">
      {/* Order here is visual, not semantic: in RTL the first child renders
          rightmost. The reference reads, right to left, live call, microphone,
          field, attach -- so that is the order they appear in. */}
      <div className="mentor__bar">
        <button
          aria-label="שיחת לייב עם אווטאר"
          className="mentor__round mentor__round--live"
          onClick={() => setNotice(NOT_CONNECTED)}
          type="button"
        >
          {liveIcon}
        </button>

        <button
          aria-label="הקלטה קולית"
          className="mentor__round"
          onClick={() => setNotice(NOT_CONNECTED)}
          type="button"
        >
          {micIcon}
        </button>

        <input
          aria-label="הודעה למנטור"
          className="mentor__field"
          onChange={(event) => setDraft(event.target.value)}
          placeholder="כתבי למנטור…"
          type="text"
          value={draft}
        />

        <button
          aria-label="הוספת קובץ"
          className="mentor__round"
          onClick={() => setNotice(NOT_CONNECTED)}
          type="button"
        >
          {plusIcon}
        </button>
      </div>

      {notice ? <p className="mentor__notice" role="status">{notice}</p> : null}
    </section>
  )
}
