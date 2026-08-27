'use client'

import { useEffect, useRef, useState } from 'react'
import { BottomSheet } from '../brain/BottomSheet'
import { useApiErrorHandler } from '../brain/use-api-error'
import type { Assignment } from './assignments-api'
import type { PersuaderApi, ConversationTurn, ConversationSnapshot } from './persuader-api'

type Phase =
  | { kind: 'opening' }
  | { kind: 'ready' }
  | { kind: 'thinking' }
  | { kind: 'finished'; outcome: string }
  | { kind: 'failed'; message: string }

/**
 * The bot talking to a person about one assignment.
 *
 * A sheet, because this is a conversation held in the middle of a shift on a
 * phone: it has to cover the list without losing it. It inherits Escape, focus
 * on open and focus restored on close from the primitive the brain built.
 */
export function Conversation({ assignment, persuaderApi, onClose }: {
  assignment: Assignment
  persuaderApi: PersuaderApi
  onClose: () => void
}) {
  const handleError = useApiErrorHandler()
  const [turns, setTurns] = useState<ConversationTurn[]>([])
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' })
  const [reply, setReply] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    let cancelled = false

    persuaderApi.openConversation({ assignmentId: assignment.id })
      .then((result) => {
        if (cancelled) return
        setTurns(result.turns)
        setSnapshot(result.state)
        setPhase({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        // A failure has to say so. A sheet that sits on "מתחילה" forever is
        // indistinguishable from a model taking its time, and the person waits.
        if (handleError(error)) setPhase({ kind: 'failed', message: 'לא הצלחנו להתחיל את השיחה. נסי שוב.' })
      })

    return () => { cancelled = true }
  }, [assignment.id, handleError, persuaderApi])

  const send = async () => {
    if (!reply.trim()) return
    const said = reply
    setReply('')
    setPhase({ kind: 'thinking' })

    try {
      const result = await persuaderApi.reply({ assignmentId: assignment.id, turns, reply: said })
      setTurns(result.turns)
      setSnapshot(result.state)
      setPhase({ kind: 'ready' })
    } catch (error) {
      if (handleError(error)) setPhase({ kind: 'failed', message: 'התשובה לא נשלחה. נסי שוב.' })
    }
  }

  /**
   * Finishing writes an `asked` event and settles nothing, whatever the
   * outcome. Agreement is not execution, and only an execution report may close
   * an assignment -- so the sheet says so rather than letting "היא הסכימה" read
   * as done.
   */
  const finish = async () => {
    setPhase({ kind: 'thinking' })
    try {
      const result = await persuaderApi.finish({ assignmentId: assignment.id, turns })
      setPhase({ kind: 'finished', outcome: result.outcome })
    } catch (error) {
      if (handleError(error)) setPhase({ kind: 'failed', message: 'לא הצלחנו לסגור את השיחה. נסי שוב.' })
    }
  }

  return (
    <BottomSheet
      initialFocusRef={replyRef}
      label="שיחת שכנוע"
      onDismiss={onClose}
      openKey={assignment.id}
    >
      <h2 className="rule-edit-sheet__title">{assignment.rule?.text ?? 'שיחת שכנוע'}</h2>

      {snapshot ? (
        // The rung and the blocker are shown, not hidden: the blocker is what
        // chose the next argument, so without it the reply reads as arbitrary.
        <p className="conversation__state">
          {`שלב ${snapshot.rung}`}
          {snapshot.blocker && snapshot.blocker !== 'none' ? ` · ${snapshot.blocker}` : ''}
        </p>
      ) : null}

      <div className="conversation__thread">
        {turns.map((turn, index) => (
          <p className="conversation__msg" data-from={turn.speaker} key={`${turn.speaker}-${index}`}>
            {turn.text}
          </p>
        ))}
        {phase.kind === 'opening' ? <p className="knowledge-message">מתחילה…</p> : null}
        {phase.kind === 'thinking' ? <p className="knowledge-message">חושבת…</p> : null}
      </div>

      {phase.kind === 'failed' ? (
        <p className="knowledge-message" role="alert">{phase.message}</p>
      ) : null}

      {phase.kind === 'finished' ? (
        <p className="knowledge-message" role="status">
          {`השיחה הסתיימה: ${phase.outcome}. המשימה לא נסגרה — רק דיווח ביצוע סוגר אותה.`}
        </p>
      ) : (
        <>
          <label className="rule-edit-sheet__field" htmlFor="conversation-reply">
            <span>התשובה שלה</span>
            <textarea
              className="rule-edit-sheet__textarea"
              id="conversation-reply"
              onChange={(event) => setReply(event.target.value)}
              ref={replyRef}
              rows={2}
              value={reply}
            />
          </label>

          <div className="brain-card__actions">
            <button
              data-weight="primary"
              disabled={phase.kind !== 'ready'}
              onClick={() => void send()}
              type="button"
            >
              שליחה
            </button>
            <button data-weight="quiet" onClick={() => void finish()} type="button">סיום</button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
