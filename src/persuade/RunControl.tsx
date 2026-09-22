'use client'

import { useState } from 'react'
import type { Role } from '../brain/types'
import { useApiErrorHandler } from '../brain/use-api-error'
import { INDUSTRY_LABELS, industryLabel } from './cell'
import { SILENT_TURN_MARKER } from './engine/prompts'
import { DEFAULT_RULES } from './engine/rules'
import type { PersuasionPlan, TargetPersona, Turn } from './engine/types'
import { streamSimulation } from './simulate-api'

/**
 * The closed list the database itself enforces (see cell.ts's own note about
 * the check constraint on `simulations.industry`). Free text here used to let
 * an operator type a word the constraint would reject -- a run that looked
 * like it started and then failed to save.
 */
const INDUSTRY_SLUGS = Object.keys(INDUSTRY_LABELS)

/**
 * The lab could read runs long before it could start one, which made the matrix
 * permanently empty and the whole screen a view of nothing. This is the control
 * that produces the evidence the rest of the screen is built on.
 */

/** Only what the option list needs. The route takes an id, never a persona. */
export type PersonaOption = Pick<TargetPersona, 'id' | 'name' | 'role'>

interface RunControlProps {
  personas: PersonaOption[]
  /**
   * The whole plan, because the whole plan is what travels in the config -- the
   * simulate route validates it and hands it to the engine. Safe to send from
   * here in a way an assignment's plan is not: a library plan is committed
   * content with no ammunition in it, so nothing about a person is at stake.
   */
  plans: PersuasionPlan[]
  roles: Role[]
  onFinished: () => void
}

const ROLE_LABEL: Record<Turn['role'], string> = { persuader: 'המשכנע', target: 'הצד השני' }

export function RunControl({ onFinished, personas, plans, roles }: RunControlProps) {
  // Shared with every other surface here, and the reason is the 401: an expired
  // session becomes a trip to sign in rather than a message on a screen where
  // nothing left works.
  const handleError = useApiErrorHandler()

  const [industry, setIndustry] = useState(INDUSTRY_SLUGS[0] ?? '')
  /**
   * Empty means "whatever the first role is", resolved on every render rather
   * than captured once.
   *
   * The screen above loads its roles asynchronously, so this always mounts with
   * an empty list -- and a default read once at mount would leave the state at
   * '' while the select displayed a real role. job_role_id no longer decides
   * where a run lands in the grid: placement is an exact match of the run's
   * plan id against the taxonomy (see cell.ts's placeRun), regardless of what
   * role was chosen here. This default exists only so the row is not saved
   * with a blank job_role_id, not to avoid a misplaced run.
   */
  const [chosenRoleId, setChosenRoleId] = useState('')
  const jobRoleId = chosenRoleId || roles[0]?.id || ''
  const [personaId, setPersonaId] = useState(personas[0]?.id ?? '')
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')

  const [turns, setTurns] = useState<Turn[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function start(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setNotice('')

    // The industry no longer decides which cell a run lands in -- placement is
    // an exact match of the plan's id against the taxonomy (cell.ts's
    // placeRun), whatever is chosen here. It is still recorded on every row
    // and still required by the database, so an empty value is refused before
    // ten model calls are spent finding that out from the route instead.
    if (!industry.trim()) {
      setError('צריך לבחור ענף כדי לשמור את הריצה.')
      return
    }
    const plan = plans.find((p) => p.id === planId)
    if (!plan) {
      setError('צריך לבחור נושא לשיחה.')
      return
    }

    setRunning(true)
    setTurns([])
    try {
      await streamSimulation(
        {
          config: { rules: DEFAULT_RULES, plan },
          personaId,
          cell: { industry: industry.trim(), jobRoleId: jobRoleId || null },
        },
        (event_) => {
          if (event_.type === 'turn') setTurns((current) => [...current, event_.turn])
          // Kept rather than dropped, but it can never reach the bank, which is
          // built from the score. A cell showing runs and no winning arguments
          // is confusing to meet later and cheap to explain here.
          if (event_.type === 'unscored')
            setNotice('הריצה נשמרה אבל לא נוקדה, ולכן לא תיכנס לבנק הטיעונים.')
          if (event_.type === 'stopped') setNotice(`השיחה נעצרה: ${event_.reason}`)
          if (event_.type === 'error') setError(event_.message)
          // `saved`, not `done`. The route scores and inserts after the engine
          // has finished, so reloading on `done` re-queries before the row
          // exists and the matrix comes back without the run just watched.
          if (event_.type === 'saved') onFinished()
          if (event_.type === 'unsaved')
            setError('השיחה הסתיימה אבל לא נשמרה, ולכן היא לא תופיע במטריצה.')
        },
      )
    } catch (failure) {
      const message = handleError(failure)
      if (message) setError(message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <form className="run-control" onSubmit={start}>
      <div className="run-control__fields">
        <label>
          ענף
          <select onChange={(e) => setIndustry(e.target.value)} value={industry}>
            {INDUSTRY_SLUGS.map((slug) => (
              <option key={slug} value={slug}>
                {industryLabel(slug)}
              </option>
            ))}
          </select>
        </label>

        <label>
          תפקיד
          <select onChange={(e) => setChosenRoleId(e.target.value)} value={jobRoleId}>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          דמות
          <select onChange={(e) => setPersonaId(e.target.value)} value={personaId}>
            {personas.map((persona) => (
              <option
                key={persona.id}
                value={persona.id}
              >{`${persona.name} · ${persona.role}`}</option>
            ))}
          </select>
        </label>

        <label>
          נושא
          <select onChange={(e) => setPlanId(e.target.value)} value={planId}>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.topic}
              </option>
            ))}
          </select>
        </label>
      </div>

      <button disabled={running} type="submit">
        {running ? 'רץ…' : 'הרצת סימולציה'}
      </button>

      {error ? (
        <p className="knowledge-message" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? <p className="knowledge-message">{notice}</p> : null}

      {turns.length ? (
        // Announced politely rather than assertively: a run is ten turns, and an
        // assertive region would interrupt a screen reader on every one of them.
        <ol aria-live="polite" className="run-control__turns">
          {turns.map((turn, index) => (
            <li
              className="run-control__turn"
              data-role={turn.role}
              key={`${turn.interaction}-${index}`}
            >
              <span className="run-control__who">{ROLE_LABEL[turn.role]}</span>
              {/* A silent turn's `text` is deliberately empty (see Turn.silent
                  in engine/types.ts): rendering it plain would show an empty
                  bubble nobody sent, indistinguishable from a still-loading
                  one. The marker is what the persuader itself reads for this
                  turn (SILENT_TURN_MARKER), so the transcript on screen shows
                  the same thing the model was told. */}
              <span>{turn.silent ? SILENT_TURN_MARKER : turn.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </form>
  )
}
