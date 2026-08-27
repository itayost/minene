'use client'

import { useMemo, useState } from 'react'
import { Matrix, type MatrixCell } from '../../../../../src/persuade/Matrix'

/**
 * One screen, not three.
 *
 * The matrix is the navigation, the rates are the cell contents, and the bank
 * is what a cell accumulates. Splitting those into a simulator, a measurement
 * screen and a matrix would have made three surfaces that each show a third of
 * the same fact -- which is the mistake the brain's five screens made.
 */
export function LabClient() {
  const [selected, setSelected] = useState<MatrixCell | null>(null)

  // Nothing has been run yet, and the screen says so rather than drawing an
  // empty grid. The matrix is populated from public.simulations once the lab
  // can run; until then an honest empty state beats an illustration.
  const cells = useMemo<MatrixCell[]>(() => [], [])

  return (
    <div className="brain-surface">
      <section aria-label="מעבדת השכנוע" className="knowledge-shell" dir="rtl">
        <header className="knowledge-header">
          <h2>מעבדת השכנוע</h2>
        </header>

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
          </section>
        ) : null}
      </section>
    </div>
  )
}
