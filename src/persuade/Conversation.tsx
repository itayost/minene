'use client'

import { useEffect, useRef, useState } from 'react'
import { BottomSheet } from '../brain/BottomSheet'
import { useApiErrorHandler } from '../brain/use-api-error'
import type { Assignment } from './assignments-api'
import type { ConversationState, Turn } from './engine/types'
import type { PersuaderApi } from './persuader-api'

/** The blocker that explains the most recent reply, or none. */
const lastBlocker = (state: ConversationState): string | null => {
  const real = state.blockers.filter((b) => b !== 'none')
  return real.length ? (real[real.length - 1] ?? null) : null
}

type Phase =
  | { kind: 'opening' }
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'thinking' }
  | { kind: 'finished'; outcome: string }
  | { kind: 'failed'; message: string }

/** The two waits worth naming, and they are not the same wait. */
const WAITING: Partial<Record<Phase['kind'], string>> = {
  opening: 'מתחילה…',
  // Only ever seen on the first conversation about an assignment, when the plan
  // has to be built before a word can be said. Every later one reads a cached
  // plan and goes straight to writing.
  preparing: 'מכינה את השיחה…',
  thinking: 'כותבת…',
}

/**
 * The bot talking to a person about one assignment.
 *
 * A sheet, because this is a conversation held in the middle of a shift on a
 * phone: it has to cover the list without losing it. It inherits Escape, focus
 * on open and focus restored on close from the primitive the brain built.
 */
export function Conversation({
  assignment,
  persuaderApi,
  onClose,
}: {
  assignment: Assignment
  persuaderApi: PersuaderApi
  onClose: () => void
}) {
  const handleError = useApiErrorHandler()
  const [turns, setTurns] = useState<Turn[]>([])
  const [snapshot, setSnapshot] = useState<ConversationState | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'opening' })
  const [reply, setReply] = useState('')
  /**
   * The bot's message while it is still being written.
   *
   * Held apart from `turns` rather than appended to it, because a half-written
   * message is not a turn: it has no blocker, no rung and no rule check yet,
   * and anything reading `turns` as the conversation so far would be reading a
   * sentence that is not finished. It is replaced by the real turn, never
   * merged with it.
   */
  const [draft, setDraft] = useState('')
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)

  /**
   * The thread is a 40dvh scroller, so a message that grows past the fold grows
   * out of sight. Pinned to the bottom on every change, which is what a
   * messaging thread does and what makes a streamed reply readable at all.
   */
  // `turns` and `draft` are triggers, not reads: the body never uses either, and
  // a change to them is exactly what must re-run the scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deliberate trigger dependencies
  useEffect(() => {
    const thread = threadRef.current
    if (thread) thread.scrollTop = thread.scrollHeight
  }, [turns, draft])

  useEffect(() => {
    let cancelled = false

    const watch = {
      onPreparing: () => {
        if (!cancelled) setPhase({ kind: 'preparing' })
      },
      onDelta: (soFar: string) => {
        if (!cancelled) setDraft(soFar)
      },
    }

    persuaderApi
      .openConversation({ assignmentId: assignment.id }, watch)
      .then((result) => {
        if (cancelled) return
        setDraft('')
        setTurns(result.turns)
        setSnapshot(result.state)
        setPhase({ kind: 'ready' })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setDraft('')
        // A failure has to say so. A sheet that sits on "מתחילה" forever is
        // indistinguishable from a model taking its time, and the person waits.
        if (handleError(error))
          setPhase({ kind: 'failed', message: 'לא הצלחנו להתחיל את השיחה. נסי שוב.' })
      })

    return () => {
      cancelled = true
    }
  }, [assignment.id, handleError, persuaderApi])

  const send = async () => {
    if (!reply.trim()) return
    const said = reply.trim()
    setReply('')
    setPhase({ kind: 'thinking' })

    /**
     * Her own message goes up immediately, before the request is even sent.
     *
     * It used to wait for the server, which returns the whole turn list at
     * once -- so pressing שליחה emptied the box and showed nothing until the
     * bot had finished answering. In a conversation that is meant to read like
     * WhatsApp, the one message that never needs waiting for is your own.
     *
     * `turns` is the list the request was built from, so the optimistic entry
     * is added to the render and not to what is sent; the server's list
     * replaces it wholesale below and is the only one that is ever posted back.
     */
    const sent = turns
    setTurns([...sent, { role: 'target', text: said, interaction: snapshot?.interaction ?? 0 }])

    try {
      const result = await persuaderApi.reply(
        { assignmentId: assignment.id, turns: sent, reply: said },
        {
          onPreparing: () => setPhase({ kind: 'preparing' }),
          onDelta: setDraft,
        },
      )
      setDraft('')
      setTurns(result.turns)
      setSnapshot(result.state)
      setPhase({ kind: 'ready' })
    } catch (error) {
      // Rolled back to what the server last confirmed, and the text put back in
      // the box. A failed send that leaves her message on screen reads as sent.
      setDraft('')
      setTurns(sent)
      setReply(said)
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
      setTurns(result.turns)
      setPhase({ kind: 'finished', outcome: result.state.outcome })
    } catch (error) {
      if (handleError(error))
        setPhase({ kind: 'failed', message: 'לא הצלחנו לסגור את השיחה. נסי שוב.' })
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
          {/* blockers is a list, not a field: the state accumulates every one
              detected, and the one that explains the reply just given is the
              last. An earlier version read a singular `blocker` that the engine
              has never had, so this line rendered nothing at all. */}
          {lastBlocker(snapshot) ? ` · ${lastBlocker(snapshot)}` : ''}
        </p>
      ) : null}

      <div className="conversation__thread" ref={threadRef}>
        {turns.map((turn, index) => (
          <p className="conversation__msg" data-from={turn.role} key={`${turn.role}-${index}`}>
            {turn.text}
          </p>
        ))}
        {draft ? (
          // The same bubble the finished message will occupy, so the text does
          // not jump from a status line into a message when it lands.
          // aria-live, because a screen reader gets nothing from a bubble that
          // grows; it is polite so it is read once it settles rather than
          // re-announced on every token.
          <p
            aria-live="polite"
            className="conversation__msg"
            data-from="persuader"
            data-writing="true"
          >
            {draft}
          </p>
        ) : WAITING[phase.kind] ? (
          <p className="knowledge-message">{WAITING[phase.kind]}</p>
        ) : null}
      </div>

      {phase.kind === 'failed' ? (
        <p className="knowledge-message" role="alert">
          {phase.message}
        </p>
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
            {/* Closed while a message is in flight, which it was not before.
                `turns` now holds her own reply optimistically, so finishing
                mid-answer would post a turn the engine has not graded and settle
                the record from it. Failing is also allowed to end a
                conversation: closing a broken one is the only way out of it. */}
            <button
              data-weight="quiet"
              disabled={
                phase.kind === 'opening' || phase.kind === 'preparing' || phase.kind === 'thinking'
              }
              onClick={() => void finish()}
              type="button"
            >
              סיום
            </button>
          </div>
        </>
      )}
    </BottomSheet>
  )
}
