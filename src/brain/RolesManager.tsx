'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { BottomSheet } from './BottomSheet'
import type { RolesApi } from './roles-api'
import { useApiErrorHandler } from './use-api-error'
import type { Role } from './types'

/**
 * The org chart, editable. public.roles is per-tenant and unconstrained by any
 * check constraint precisely so this can exist: the two seeded roles are what
 * one business asked for, and the next one has assistant managers and stockroom
 * staff.
 *
 * A sheet, not a panel. It used to be a collapsed <details> bar sitting between
 * the KPI strip and the topic ribbon with nothing saying what it was -- which is
 * exactly how the owner of the product came to ask what it did. Something edited
 * a few times a year is a settings door, and a door opens over the page rather
 * than living in the middle of it.
 */
export function RolesManager({ rolesApi, isOpen, onClose }: {
  rolesApi: Pick<RolesApi, 'listRoles' | 'createRole' | 'deleteRole'>
  isOpen: boolean
  onClose: () => void
}) {
  const handleError = useApiErrorHandler()
  const [roles, setRoles] = useState<Role[]>([])
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const nameRef = useRef<HTMLInputElement>(null)

  const reload = useCallback(async () => {
    setIsLoading(true)
    try {
      setRoles(await rolesApi.listRoles())
      setError('')
    } catch (failure) {
      // The API phrases every failure it raises in Hebrew, including the
      // duplicate-name case, which is the one a person can actually fix.
      // Overwriting it with a generic sentence would throw that away.
      const message = handleError(failure)
      if (message) setError(message)
    } finally {
      setIsLoading(false)
    }
  }, [handleError, rolesApi])

  useEffect(() => { void reload() }, [reload])

  const run = async (id: string, work: () => Promise<unknown>) => {
    setBusyId(id)
    try {
      await work()
      setError('')
      // Read the list back rather than guessing at it: sort_order is assigned
      // server side, so the resulting order is only knowable by asking.
      await reload()
    } catch (failure) {
      const message = handleError(failure)
      if (message) setError(message)
    } finally {
      setBusyId('')
    }
  }

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    await run('new', async () => {
      await rolesApi.createRole({ name: draftName })
      setDraftName('')
    })
  }

  return (
    <BottomSheet initialFocusRef={nameRef} label="תפקידים" onDismiss={onClose} openKey={isOpen ? 'roles' : null}>
      <div className="roles-manager">
      <h2 className="rule-edit-sheet__title">תפקידים</h2>

      {/* States the consequence before the button is pressed. Deleting a role is
          not destructive here -- the rules it addressed revert to addressing
          everyone -- but "delete" reads as though it might be, and someone who
          believes it deletes rules will simply never fix a wrong role. */}
      <p className="roles-manager__note">
        מחיקת תפקיד אינה מוחקת חוקים. חוקים שהיו משויכים אליו יחזרו לחול על כל התפקידים.
      </p>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      <ul className="roles-manager__list">
        {roles.map((role) => (
          <li key={role.id}>
            <span>{role.name}</span>
            {/* Named, because the visible label repeats down the list. */}
            <button
              aria-label={`מחיקת התפקיד ${role.name}`}
              disabled={busyId === role.id}
              onClick={() => void run(role.id, () => rolesApi.deleteRole({ roleId: role.id }))}
              type="button"
            >
              מחיקה
            </button>
          </li>
        ))}
      </ul>

      {!isLoading && roles.length === 0 ? (
        <p className="admin-empty">עדיין לא הוגדרו תפקידים.</p>
      ) : null}

      <form className="roles-manager__add" onSubmit={(event) => void add(event)}>
        <label htmlFor="new-role-name">תפקיד חדש</label>
        <input
          id="new-role-name"
          maxLength={40}
          onChange={(event) => setDraftName(event.target.value)}
          ref={nameRef}
          type="text"
          value={draftName}
        />
        <button disabled={busyId === 'new'} type="submit">הוספה</button>
      </form>
      </div>
    </BottomSheet>
  )
}
