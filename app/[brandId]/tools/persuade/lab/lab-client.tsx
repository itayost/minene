'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { createRolesApi, type RolesClient } from '../../../../../src/brain/roles-api'
import type { Role } from '../../../../../src/brain/types'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import { blockersIn, buildBank } from '../../../../../src/persuade/bank'
import type { PersuasionPlan } from '../../../../../src/persuade/engine/types'
import { BLOCKER_LABELS, CATEGORY_LABELS } from '../../../../../src/persuade/labels'
import type { StoredSimulation } from '../../../../../src/persuade/lib/simulations'
import { Matrix, type MatrixCell } from '../../../../../src/persuade/Matrix'
import { matrixFrom } from '../../../../../src/persuade/matrix-data'
import { type PersonaOption, RunControl } from '../../../../../src/persuade/RunControl'
import { createSimulationsApi } from '../../../../../src/persuade/simulations-api'

interface LabClientProps {
  personas: PersonaOption[]
  plans: PersuasionPlan[]
}

/**
 * One screen, not three.
 *
 * The matrix is the navigation, the rates are the cell contents, and the bank
 * is what a cell accumulates. Splitting those into a simulator, a measurement
 * screen and a matrix would have made three surfaces that each show a third of
 * the same fact -- which is the mistake the brain's five screens made.
 */
export function LabClient({ personas, plans }: LabClientProps) {
  const simulationsApi = useMemo(() => createSimulationsApi(createBrowserSupabase() as never), [])
  const rolesApi = useMemo(
    () => createRolesApi(createBrowserSupabase() as unknown as RolesClient),
    [],
  )
  const handleError = useApiErrorHandler()

  const [selected, setSelected] = useState<MatrixCell | null>(null)
  const [simulations, setSimulations] = useState<StoredSimulation[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [runs, catalogue] = await Promise.all([
        simulationsApi.listSimulations(),
        rolesApi.listRoles(),
      ])
      setSimulations(runs)
      setRoles(catalogue)
    } catch (failure) {
      if (handleError(failure)) setError('לא הצלחנו לטעון את הריצות')
    }
  }, [handleError, rolesApi, simulationsApi])

  useEffect(() => {
    void load()
  }, [load])

  const cells = useMemo(
    () =>
      matrixFrom(
        simulations,
        roles.map((r) => ({ id: r.id, name: r.name })),
      ),
    [roles, simulations],
  )

  // The bank and the blockers are queries over the selected cell's runs, never
  // a stored list -- so they cannot disagree with the evidence behind them.
  const inCell = useMemo(
    () =>
      selected
        ? simulations.filter(
            (s) => s.cell.industry === selected.industry && s.cell.jobRoleId === selected.jobRoleId,
          )
        : [],
    [selected, simulations],
  )
  const bank = useMemo(() => buildBank(inCell.map((s) => s.run)), [inCell])
  const blockers = useMemo(() => blockersIn(inCell.map((s) => s.run)), [inCell])

  return (
    <div className="brain-surface">
      <section aria-label="מעבדת השכנוע" className="knowledge-shell" dir="rtl">
        <header className="knowledge-header">
          <h2>מעבדת השכנוע</h2>
        </header>

        {error ? (
          <p className="knowledge-message" role="alert">
            {error}
          </p>
        ) : null}

        {/* Outside the "are there runs" branch below, deliberately. The matrix
            is built from runs, so it is empty until one exists -- and a control
            inside that branch would make the first run the one thing this
            screen could never do. */}
        <RunControl onFinished={load} personas={personas} plans={plans} roles={roles} />

        {cells.length === 0 ? (
          <p className="knowledge-message">
            עדיין לא רצו סימולציות. המטריצה נבנית מהריצות, ולכן היא ריקה עד שתהיה הראשונה.
          </p>
        ) : (
          <>
            <Matrix cells={cells} onSelect={setSelected} selected={selected} />

            {/* Each end is labelled where it sits rather than described by an
                arrow beside the ramp. "0% ← 100%" as one string forces the
                reader to work out which end the arrow means, and in RTL that is
                genuinely ambiguous. */}
            <div className="matrix-legend">
              <span>שיעור שכנוע</span>
              <span className="matrix-legend__scale">
                <span>0%</span>
                <span aria-hidden="true" className="matrix-legend__ramp">
                  <i className="cell" data-heat="1" />
                  <i className="cell" data-heat="2" />
                  <i className="cell" data-heat="3" />
                  <i className="cell" data-heat="4" />
                  <i className="cell" data-heat="5" />
                </span>
                <span>100%</span>
              </span>
              <span className="matrix-legend__none">
                <i aria-hidden="true" className="cell" data-heat="none" />
                אין ריצות — לא אפס אחוז
              </span>
            </div>
          </>
        )}

        {selected ? (
          <section aria-label={`${selected.industry} · ${selected.jobRoleName}`}>
            <h3 className="knowledge-heading">{`${selected.industry} · ${selected.jobRoleName}`}</h3>
            <p className="knowledge-message">
              {selected.persuasionRate === null
                ? 'אין ריצות בתא הזה, ולכן אין מה למדוד בו עדיין.'
                : `${selected.runs} ריצות · ${selected.persuasionRate}% שכנוע`}
            </p>

            {selected.modelsMixed ? (
              // The rate above pools every run in the cell regardless of which
              // persuader model produced it. A swap mid-history blends two
              // model generations into one number with nothing else on screen
              // to say so -- the same caveat report:techniques already prints
              // for a technique's win rate, just missing here until now.
              <p className="knowledge-message">
                שים לב: הריצות בתא הזה רצו על יותר ממודל שכנוע אחד — השיעור עלול לשקף החלפת מודל ולא
                את הענף או התפקיד.
              </p>
            ) : null}

            {bank.length ? (
              <ul className="bank">
                {bank.map((entry) => (
                  <li className="bank__row" key={entry.category}>
                    <span className="bank__category">{CATEGORY_LABELS[entry.category]}</span>
                    <span>{entry.examples[0] ?? '—'}</span>
                    <span className="bank__won">{`ניצח ${entry.wonCount}×`}</span>
                  </li>
                ))}
              </ul>
            ) : selected.runs > 0 ? (
              // Runs but no bank means nothing was scored, which is a different
              // fact from nothing having been run, and worth saying separately.
              <p className="knowledge-message">
                אף ריצה בתא הזה לא נוקדה, ולכן אין עדיין טיעונים מנצחים.
              </p>
            ) : null}

            {blockers.length ? (
              <p className="knowledge-message">
                {`החסם השכיח כאן: ${BLOCKER_LABELS[blockers[0]!.blocker]} — נתקלו בו ${blockers[0]!.encountered} פעמים, נשבר ב-${blockers[0]!.overcome}.`}
              </p>
            ) : null}
          </section>
        ) : null}
      </section>
    </div>
  )
}
