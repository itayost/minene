'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createBrowserSupabase } from '../../../../../src/auth/supabase-browser'
import { createRolesApi, type RolesClient } from '../../../../../src/brain/roles-api'
import type { Role } from '../../../../../src/brain/types'
import { useApiErrorHandler } from '../../../../../src/brain/use-api-error'
import { blockersIn } from '../../../../../src/persuade/bank'
import { Counters } from '../../../../../src/persuade/Counters'
import { cellIndex, planKeyFor } from '../../../../../src/persuade/cell'
import { coverageOf, gridFrom, placeAll } from '../../../../../src/persuade/coverage'
import type { PersuasionPlan } from '../../../../../src/persuade/engine/types'
import { createLabPlansApi } from '../../../../../src/persuade/lab-plans-api'
import { BLOCKER_LABELS } from '../../../../../src/persuade/labels'
import type { StoredSimulation } from '../../../../../src/persuade/lib/simulations'
import { Matrix, type MatrixCell } from '../../../../../src/persuade/Matrix'
import { persuasionsFor } from '../../../../../src/persuade/persuasions'
import { type PersonaOption, RunControl } from '../../../../../src/persuade/RunControl'
import { createSimulationsApi } from '../../../../../src/persuade/simulations-api'
import { type NeedRow, taxonomyFrom } from '../../../../../src/persuade/taxonomy'
import { createTaxonomyApi } from '../../../../../src/persuade/taxonomy-api'
import { useLiveCounts } from '../../../../../src/persuade/use-live-counts'

interface LabClientProps {
  personas: PersonaOption[]
  plans: PersuasionPlan[]
  /** PERSUADER_DAILY_RUN_CAP, read on the server. It is not a public variable. */
  dailyCap: number
}

/**
 * One screen, not three.
 *
 * The grid is the navigation, the needs are what a cell contains, and the
 * persuasions are what a need accumulates. Splitting those into a simulator, a
 * measurement screen and a matrix would have made three surfaces that each show
 * a third of the same fact -- the mistake the brain's five screens made.
 *
 * What changed on 2026-09-22: the grid is drawn from role_needs rather than
 * from the runs. A sector nobody has run used to be absent from the screen,
 * which answers "what have we measured". This screen answers "where has the
 * sweep been", and for that question an empty cell is the whole point.
 */
export function LabClient({ personas, plans, dailyCap }: LabClientProps) {
  const client = useMemo(() => createBrowserSupabase(), [])
  const simulationsApi = useMemo(() => createSimulationsApi(client as never), [client])
  const taxonomyApi = useMemo(() => createTaxonomyApi(client as never), [client])
  const labPlansApi = useMemo(() => createLabPlansApi(client as never), [client])
  const rolesApi = useMemo(() => createRolesApi(client as unknown as RolesClient), [client])
  const handleError = useApiErrorHandler()

  const [simulations, setSimulations] = useState<StoredSimulation[]>([])
  const [needRows, setNeedRows] = useState<NeedRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [plan, setPlan] = useState<PersuasionPlan | null>(null)
  const [error, setError] = useState('')

  const { counts, stale, lastOk, refresh } = useLiveCounts(simulationsApi)

  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const industry = params.get('industry')
  const role = params.get('role')
  const need = params.get('need')

  /**
   * One state, not two. A filter and a drill-down each holding their own copy
   * of "which cell" would be two things to keep in agreement, and the URL is
   * the copy that also makes a cell a link.
   */
  const select = useCallback(
    (next: { industry?: string | null; role?: string | null; need?: string | null }) => {
      const query = new URLSearchParams(params.toString())
      for (const [key, value] of Object.entries(next)) {
        if (value) query.set(key, value)
        else query.delete(key)
      }
      router.replace(`${pathname}?${query.toString()}`, { scroll: false })
    },
    [params, pathname, router],
  )

  const load = useCallback(async () => {
    try {
      const [runs, needs, catalogue] = await Promise.all([
        // Summaries, not full rows: `turns` is a whole conversation and nothing
        // here reads one. At the cap this screen exists to show, that column is
        // the difference between a few megabytes and a few hundred.
        simulationsApi.listSimulationSummaries(),
        taxonomyApi.listRoleNeeds(),
        rolesApi.listRoles(),
      ])
      setSimulations(runs)
      setNeedRows(needs)
      setRoles(catalogue)
    } catch (failure) {
      if (handleError(failure)) setError('לא הצלחנו לטעון את הריצות')
    }
  }, [handleError, rolesApi, simulationsApi, taxonomyApi])

  useEffect(() => {
    void load()
  }, [load])

  const taxonomy = useMemo(() => taxonomyFrom(needRows), [needRows])
  const index = useMemo(() => cellIndex(needRows), [needRows])
  const placed = useMemo(() => placeAll(index, simulations), [index, simulations])
  const cells = useMemo(() => gridFrom(taxonomy, placed), [taxonomy, placed])

  const selectedRole = useMemo(
    () =>
      taxonomy
        .find((entry) => entry.industry === industry)
        ?.roles.find((entry) => entry.roleSlug === role) ?? null,
    [industry, role, taxonomy],
  )

  const selectedCell = useMemo(
    () => cells.find((cell) => cell.industry === industry && cell.roleSlug === role) ?? null,
    [cells, industry, role],
  )

  const needRuns = useMemo(
    () =>
      industry && role && need ? (placed.runsByCell.get(`${industry}/${role}/${need}`) ?? []) : [],
    [industry, need, placed, role],
  )

  // The plan is fetched per need rather than all 131 at once: the screen shows
  // one at a time, and each is a full plan with arguments and objections.
  useEffect(() => {
    if (!industry || !role || !need) {
      setPlan(null)
      return
    }
    let live = true
    void labPlansApi
      .getPlan(planKeyFor({ industry, roleSlug: role, needKey: need }))
      .then((found) => {
        if (live) setPlan(found)
      })
      .catch((failure) => {
        if (handleError(failure)) setError('לא הצלחנו לטעון את התוכנית')
      })
    return () => {
      live = false
    }
  }, [handleError, industry, labPlansApi, need, role])

  const persuasions = useMemo(() => persuasionsFor(plan, needRuns), [needRuns, plan])
  const blockers = useMemo(() => blockersIn(needRuns), [needRuns])

  const onSelectCell = (cell: MatrixCell) =>
    select({ industry: cell.industry, role: cell.roleSlug, need: null })

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

        <Counters
          counts={counts}
          dailyCap={dailyCap}
          lastOk={lastOk}
          onRefresh={refresh}
          stale={stale}
        />

        {/* A run that places nowhere is named, never dropped. Every run on
            record carries the briefings plan, which predates the taxonomy. */}
        {placed.unplaced > 0 ? (
          <p className="knowledge-message">
            {`${placed.unplaced} ריצות מחוץ למפה: הן רצו על תוכנית שאינה שייכת לאף ענף, תפקיד וצורך.`}
          </p>
        ) : null}

        {/* Outside the "are there runs" branch, deliberately. A control inside
            it would make the first run the one thing this screen could not do. */}
        <RunControl onFinished={load} personas={personas} plans={plans} roles={roles} />

        {cells.length === 0 ? (
          <p className="knowledge-message">מפת הצרכים ריקה, ולכן אין ממה לבנות את המטריצה.</p>
        ) : (
          <>
            <Matrix cells={cells} onSelect={onSelectCell} selected={selectedCell} />

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

        {selectedRole && industry ? (
          <section aria-label={`צרכים: ${selectedRole.roleLabel}`}>
            <h3 className="knowledge-heading">
              {`${selectedCell?.industryLabel ?? industry} · ${selectedRole.roleLabel}`}
            </h3>
            <ul className="needs">
              {selectedRole.needs.map((entry) => {
                const coverage = coverageOf(
                  placed.runsByCell.get(`${industry}/${selectedRole.roleSlug}/${entry.needKey}`) ??
                    [],
                )
                return (
                  <li key={entry.needKey}>
                    <button
                      aria-pressed={need === entry.needKey}
                      className="needs__row"
                      onClick={() => select({ need: entry.needKey })}
                      type="button"
                    >
                      <span className="needs__label">{entry.needLabel}</span>
                      <span className="needs__meta">{entry.metaNeed}</span>
                      <span className="needs__coverage">
                        {coverage.persuasionRate === null
                          ? 'אין ריצות'
                          : `${coverage.runs} ריצות · ${coverage.persuasionRate}% שכנוע`}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ) : null}

        {need ? (
          <section aria-label="שכנועים לצורך">
            {plan === null ? (
              // A need with no generated plan is a real state, not an error:
              // there are 130 needs and generation is a separate pass over them.
              <p className="knowledge-message">אין עדיין תוכנית לצורך הזה.</p>
            ) : (
              <>
                <p className="knowledge-message">
                  הניצחונות נספרים לפי קטגוריה, לא לפי המשפט עצמו: מה שהשופט רשם כטיעון המנצח הוא
                  טקסט חופשי, והקטגוריה היא הקישור היחיד שאפשר לסמוך עליו.
                </p>

                <ul className="persuasions">
                  {persuasions.arguments.map((argument) => (
                    <li className="persuasions__row" key={argument.id}>
                      <span className="persuasions__category">{argument.categoryLabel}</span>
                      <span>{argument.text}</span>
                      <span className="persuasions__won">
                        {argument.categoryWins === 0
                          ? 'עוד לא ניצח'
                          : `ניצח ${argument.categoryWins}×`}
                      </span>
                    </li>
                  ))}
                </ul>

                {persuasions.unwrittenWins.length ? (
                  <p className="knowledge-message">
                    {`ניצחו כאן בלי להיות כתובים בתוכנית: ${persuasions.unwrittenWins
                      .map((win) => `${win.categoryLabel} (${win.wonCount}×)`)
                      .join(', ')}`}
                  </p>
                ) : null}

                {needRuns.length > 0 && persuasions.scoredRuns === 0 ? (
                  // Runs but no scores is a different fact from no runs, and
                  // from runs that lost. All three read differently here.
                  <p className="knowledge-message">
                    אף ריצה כאן לא נוקדה, ולכן אין עדיין טיעונים מנצחים.
                  </p>
                ) : null}

                {blockers.length ? (
                  <p className="knowledge-message">
                    {`החסם השכיח כאן: ${BLOCKER_LABELS[blockers[0]!.blocker]} — נתקלו בו ${blockers[0]!.encountered} פעמים, נשבר ב-${blockers[0]!.overcome}.`}
                  </p>
                ) : null}
              </>
            )}
          </section>
        ) : null}
      </section>
    </div>
  )
}
