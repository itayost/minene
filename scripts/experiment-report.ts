/**
 * How an experiment's arms compare.
 *
 *   pnpm report:experiment <experiment-key>
 *   pnpm report:experiment            # lists what has run
 *
 * Derived from the runs every time. The readiness warnings are not a
 * significance test and deliberately do not look like one -- they answer the
 * two questions that make a result obviously worthless (too few runs, lopsided
 * arms) plus the one that makes it false (the arms ran on different models).
 */
import { createClient } from '@supabase/supabase-js'
import { compareArms, type ExperimentRun, readiness } from '../src/persuade/experiment-results'
import { env, readAll } from './lib/db'

interface ExperimentRow {
  experiment: string
  variant: string | null
  outcome: ExperimentRun['outcome']
  turns: ExperimentRun['turns'] | null
  score: ExperimentRun['score'] | null
  models: ExperimentRun['models']
}

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const wanted = process.argv[2]

  // Paged rather than taken in one shot: an unbounded select still comes back
  // capped at PostgREST's max-rows, so past that an arm silently loses its
  // older runs and the comparison reads as if those runs never happened.
  const rows = await readAll<ExperimentRow>((from, to) =>
    db
      .from('simulations')
      .select('experiment,variant,outcome,turns,score,models')
      .not('experiment', 'is', null)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (rows.length === 0) {
    console.log('לא רצה עדיין אף ניסוי.')
    console.log('כדי להתחיל אחד: queueExperiment ב-src/persuade/lib/experiments.ts')
    return
  }

  const names = [...new Set(rows.map((r) => r.experiment))]
  if (!wanted) {
    console.log('ניסויים שרצו:')
    for (const name of names) {
      console.log(`  ${name}  (${rows.filter((r) => r.experiment === name).length} ריצות)`)
    }
    return
  }

  const mine = rows.filter((r) => r.experiment === wanted)
  if (mine.length === 0) {
    console.log(`לא נמצא ניסוי בשם "${wanted}". קיימים: ${names.join(', ')}`)
    return
  }

  const runs: ExperimentRun[] = mine.map((r) => ({
    variant: r.variant,
    outcome: r.outcome,
    turns: r.turns ?? [],
    score: r.score ?? null,
    models: r.models ?? null,
  }))

  const arms = compareArms(runs)
  console.log(`ניסוי: ${wanted}\n`)
  console.log(
    'זרוע'.padEnd(18) + 'ריצות'.padEnd(8) + 'הסכימו'.padEnd(10) + 'ציון'.padEnd(8) + 'הודעות לכן',
  )
  for (const arm of arms) {
    console.log(
      arm.variant.padEnd(18) +
        String(arm.runs).padEnd(8) +
        `${arm.agreedPct ?? '-'}%`.padEnd(10) +
        String(arm.meanGrade ?? '-').padEnd(8) +
        String(arm.meanTurnsToYes ?? '-'),
    )
  }

  const warnings = readiness(arms, 10, runs)
  if (warnings.length > 0) {
    console.log('\nלפני שקוראים את זה:')
    for (const w of warnings) console.log(`  - ${w}`)
  } else {
    console.log('\nאין אזהרות. ההשוואה ניתנת לקריאה.')
  }
}

await main()
