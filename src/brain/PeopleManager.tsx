'use client'

import { useEffect, useState } from 'react'
import type { PeopleApi } from './people-api'
import type { RolesApi } from './roles-api'
import { useApiErrorHandler } from './use-api-error'
import type { Person, Role } from './types'

type Draft = { displayName: string; jobRoleId: string }

/**
 * Who works here, and what each of them does.
 *
 * The job role is what makes a do/don't list personal: without it every rule
 * addresses everyone, and the whole per-role axis renders as one undifferentiated
 * list. Collapsed behind <details> for the same reason RolesManager is.
 */
export function PeopleManager({ peopleApi, rolesApi }: {
  peopleApi: PeopleApi
  rolesApi: Pick<RolesApi, 'listRoles'>
}) {
  const handleError = useApiErrorHandler()
  const [people, setPeople] = useState<Person[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let cancelled = false

    Promise.all([peopleApi.listPeople(), rolesApi.listRoles()])
      .then(([loadedPeople, loadedRoles]) => {
        if (cancelled) return
        setPeople(loadedPeople)
        setRoles(loadedRoles)
        setDrafts(Object.fromEntries(loadedPeople.map((person) => [
          person.id,
          { displayName: person.displayName ?? '', jobRoleId: person.jobRoleId ?? '' },
        ])))
      })
      .catch((failure: unknown) => {
        if (cancelled) return
        const message = handleError(failure)
        if (message) setError(message)
      })

    return () => { cancelled = true }
  }, [handleError, peopleApi, rolesApi])

  const save = async (person: Person) => {
    const draft = drafts[person.id]
    if (!draft) return

    setBusyId(person.id)
    try {
      const saved = await peopleApi.updatePerson({
        personId: person.id,
        displayName: draft.displayName,
        jobRoleId: draft.jobRoleId,
      })
      setPeople((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      setError('')
    } catch (failure) {
      const message = handleError(failure)
      if (message) setError(message)
    } finally {
      setBusyId('')
    }
  }

  const set = (personId: string, field: keyof Draft, value: string) => {
    setDrafts((current) => {
      const draft = current[personId] ?? { displayName: '', jobRoleId: '' }
      return { ...current, [personId]: { ...draft, [field]: value } }
    })
  }

  return (
    <details className="people-manager">
      <summary>ניהול אנשים</summary>

      {error ? <p className="admin-error" role="alert">{error}</p> : null}

      <ul className="people-manager__list">
        {people.map((person) => {
          const draft = drafts[person.id] ?? { displayName: '', jobRoleId: '' }
          // The API leaves display_name null deliberately, because the fallback
          // is a rendering decision. This is where it gets made: a uuid dressed
          // up as a name is worse than an honest blank.
          const heading = person.displayName ?? 'ללא שם'

          return (
            <li className="people-manager__row" key={person.id}>
              <p className="people-manager__name">
                {heading}
                {/* The two tenant roles are not interchangeable: one of them can
                    approve knowledge and the other cannot. */}
                {person.role === 'owner' ? <span className="people-manager__owner">בעלים</span> : null}
              </p>

              <label>
                <span>שם</span>
                <input
                  maxLength={60}
                  onChange={(event) => set(person.id, 'displayName', event.target.value)}
                  type="text"
                  value={draft.displayName}
                />
              </label>

              <label>
                <span>תפקיד</span>
                <select
                  onChange={(event) => set(person.id, 'jobRoleId', event.target.value)}
                  value={draft.jobRoleId}
                >
                  {/* A real option rather than the absence of one: having no job
                      role is a normal, chooseable state. */}
                  <option value="">ללא תפקיד</option>
                  {roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
                </select>
              </label>

              <button
                aria-label={`שמירה: ${heading}`}
                disabled={busyId === person.id}
                onClick={() => void save(person)}
                type="button"
              >
                שמירה
              </button>
            </li>
          )
        })}
      </ul>

      {people.length === 0 ? <p className="admin-empty">עדיין אין אנשים בחשבון הזה.</p> : null}
    </details>
  )
}
