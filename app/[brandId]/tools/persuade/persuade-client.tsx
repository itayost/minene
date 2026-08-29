'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserSupabase } from '../../../../src/auth/supabase-browser'
import { BottomSheet } from '../../../../src/brain/BottomSheet'
import { BrainCard } from '../../../../src/brain/BrainCard'
import { getTopic } from '../../../../src/brain/topics'
import { useApiErrorHandler } from '../../../../src/brain/use-api-error'
import {
  type Assignment,
  type AssignmentsClient,
  createAssignmentsApi,
} from '../../../../src/persuade/assignments-api'
import { Conversation } from '../../../../src/persuade/Conversation'
import { createPersuaderApi } from '../../../../src/persuade/persuader-api'

type LoadState = { status: 'loading' | 'ready' } | { status: 'error'; message: string }

export function PersuadeClient({ brandId, role }: { brandId: string; role: 'owner' | 'staff' }) {
  const assignmentsApi = useMemo(
    () => createAssignmentsApi(createBrowserSupabase() as unknown as AssignmentsClient),
    [],
  )
  const handleError = useApiErrorHandler()

  const [rows, setRows] = useState<Assignment[]>([])
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const persuaderApi = useMemo(() => createPersuaderApi(), [])
  const [talkingAbout, setTalkingAbout] = useState<Assignment | null>(null)
  const [reporting, setReporting] = useState<Assignment | null>(null)
  const [actionError, setActionError] = useState('')
  const [savingId, setSavingId] = useState('')

  const load = useCallback(async () => {
    setState({ status: 'loading' })
    try {
      setRows(await assignmentsApi.listOpenAssignments())
      setState({ status: 'ready' })
    } catch (error) {
      if (handleError(error)) setState({ status: 'error', message: 'לא הצלחנו לטעון את המשימות' })
    }
  }, [assignmentsApi, handleError])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * `partial` settles as `not_done`, deliberately. Anything else lets the
   * measurement drift upward one generous rounding at a time -- and the whole
   * point of separating agreement from execution was to stop that.
   */
  const report = async (outcome: 'done' | 'partial' | 'not_done') => {
    if (!reporting) return
    setSavingId(reporting.id)
    setActionError('')
    try {
      await assignmentsApi.settleAssignment({
        assignmentId: reporting.id,
        status: outcome === 'done' ? 'done' : 'not_done',
      })
      setRows((current) => current.filter((row) => row.id !== reporting.id))
      setReporting(null)
    } catch (error) {
      if (handleError(error)) setActionError('לא הצלחנו לשמור את הדיווח. נסי שוב.')
    } finally {
      setSavingId('')
    }
  }

  return (
    <div className="brain-surface">
      <section aria-label="משימות השכנוע שלי" className="knowledge-shell" dir="rtl">
        <header className="knowledge-header">
          <h2>המשימות שלי</h2>
          {role === 'owner' ? (
            <div className="knowledge-owner-tools">
              <Link href={`/${brandId}/tools/persuade/lab`}>מעבדה</Link>
            </div>
          ) : null}
        </header>

        {state.status === 'error' ? (
          <p className="knowledge-message" role="alert">
            {state.message}
          </p>
        ) : state.status === 'loading' ? (
          <p className="knowledge-message">טוענת…</p>
        ) : rows.length === 0 ? (
          <p className="knowledge-message">אין כרגע משימות פתוחות.</p>
        ) : null}

        {actionError ? (
          <p className="knowledge-message" role="alert">
            {actionError}
          </p>
        ) : null}

        <ul className="knowledge-list">
          {rows.map((row) => (
            <BrainCard
              as="li"
              actions={
                <>
                  <button
                    data-weight="primary"
                    disabled={savingId === row.id || !row.rule}
                    onClick={() => setTalkingAbout(row)}
                    type="button"
                  >
                    לפתוח שיחה
                  </button>
                  <button
                    data-weight="quiet"
                    disabled={savingId === row.id}
                    onClick={() => setReporting(row)}
                    type="button"
                  >
                    דיווח ביצוע
                  </button>
                </>
              }
              head={
                row.rule ? (
                  <>
                    <span>{getTopic(row.rule.topicId)?.title ?? row.rule.topicId}</span>
                    {row.dueOn ? <span>{`עד ${row.dueOn}`}</span> : null}
                  </>
                ) : null
              }
              key={row.id}
            >
              {/* The row survives a rule that failed to join. A task that
                  vanishes from someone's list is worse than one that reads
                  awkwardly, and the id is enough to chase it. */}
              {row.rule ? row.rule.text : 'החוק לא נטען. המשימה עדיין פתוחה.'}
            </BrainCard>
          ))}
        </ul>
      </section>

      {/* The engine refuses to start without a photographable ask, so a row
          whose rule failed to join cannot open one -- the button is disabled
          rather than opening a sheet that would fail. */}
      {talkingAbout ? (
        <Conversation
          assignment={talkingAbout}
          onClose={() => {
            setTalkingAbout(null)
            void load()
          }}
          persuaderApi={persuaderApi}
        />
      ) : null}

      <BottomSheet
        label="דיווח ביצוע"
        onDismiss={() => setReporting(null)}
        openKey={reporting?.id ?? null}
      >
        <h2 className="rule-edit-sheet__title">מה קרה בפועל?</h2>
        <p className="knowledge-message">{reporting?.rule?.text ?? ''}</p>
        <div className="brain-card__actions">
          <button data-weight="primary" onClick={() => void report('done')} type="button">
            בוצע
          </button>
          <button data-weight="quiet" onClick={() => void report('partial')} type="button">
            בוצע חלקית
          </button>
          <button data-weight="quiet" onClick={() => void report('not_done')} type="button">
            לא בוצע
          </button>
        </div>
        {/* Said out loud rather than left to be discovered: a partial closes the
            assignment as not done, and somebody reporting one deserves to know
            that before they press it. */}
        <p className="rule-edit-sheet__hint">
          ביצוע חלקי נרשם כלא בוצע, כדי שהמדידה לא תזחל למעלה.
        </p>
      </BottomSheet>
    </div>
  )
}
