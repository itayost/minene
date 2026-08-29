'use client'

import { useState } from 'react'
import type { Role } from '../brain/types'
import { useApiErrorHandler } from '../brain/use-api-error'
import { DEFAULT_RULES } from './engine/rules'
import type { PersuasionPlan, TargetPersona, Turn } from './engine/types'
import { streamSimulation } from './simulate-api'

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

  const [industry, setIndustry] = useState('')
  /**
   * Empty means "whatever the first role is", resolved on every render rather
   * than captured once.
   *
   * The screen above loads its roles asynchronously, so this always mounts with
   * an empty list -- and a default read once at mount would leave the state at
   * '' while the select displayed a real role. The run would then be saved with
   * no role, and `matrixFrom` matches cells by role id, so it would sit in no
   * column of the matrix, forever.
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

    // A run with no cell is a run nothing can ever read: the matrix and the
    // bank are both queries by cell. The route refuses it too -- this refuses
    // it before ten model calls are spent finding that out.
    if (!industry.trim()) {
      setError('צריך ענף. בלי ענף אין תא במטריצה שהריצה שייכת אליו.')
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
          <input
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="אופנה, מסעדנות, קמעונאות"
            value={industry}
          />
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
              <span>{turn.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </form>
  )
}
