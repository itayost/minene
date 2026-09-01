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
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { compareArms, type ExperimentRun, readiness } from '../src/persuade/experiment-results'

function env(): { url: string; key: string } {
  try {
    const file = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of file.split('\n')) {
      const at = line.indexOf('=')
      if (at > 0 && !line.trimStart().startsWith('#')) {
        const name = line.slice(0, at).trim()
        if (!process.env[name]) process.env[name] = line.slice(at + 1).trim()
      }
    }
  } catch {
    // Already in the environment is fine.
  }
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('חסרים SUPABASE_URL ו-SUPABASE_SECRET_KEY.')
  return { url, key }
}

interface ExperimentRow {
  experiment: string | null
  variant: string | null
  outcome: ExperimentRun['outcome']
  turns: ExperimentRun['turns'] | null
  score: ExperimentRun['score'] | null
  models: ExperimentRun['models']
}

/**
 * Every experiment row, paged rather than left to whatever a bare `.select()`
 * happens to return.
 *
 * There was no `.limit()` here to begin with, which looks safer than
 * `technique-report.ts`'s old `.limit(5000)` and is not: PostgREST enforces
 * its own default row cap on any query with no `.range()` (see that file's
 * `readAll`, added in f3a34d4, for the identical shape). An experiment queued
 * through the worker at up to `PERSUADER_DAILY_RUN_CAP` runs a day crosses
 * that cap in a matter of weeks, and past it this report silently compared
 * arms built from the first page of rows only -- while printing them as if
 * they were the whole experiment.
 */
export async function fetchExperimentRows(db: SupabaseClient): Promise<ExperimentRow[]> {
  const rows: ExperimentRow[] = []
  const size = 1000
  for (let from = 0; ; from += size) {
    const { data, error } = await db
      .from('simulations')
      .select('experiment,variant,outcome,turns,score,models')
      .not('experiment', 'is', null)
      .order('created_at', { ascending: false })
      .range(from, from + size - 1)
    if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`)
    const batch = (data ?? []) as ExperimentRow[]
    rows.push(...batch)
    if (batch.length < size) return rows
  }
}

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const wanted = process.argv[2]

  const rows = await fetchExperimentRows(db)
  if (rows.length === 0) {
    console.log('לא רצה עדיין אף ניסוי.')
    console.log('כדי להתחיל אחד: queueExperiment ב-src/persuade/lib/experiments.ts')
    return
  }

  const names = [...new Set(rows.map((r) => r.experiment as string))]
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

// Guarded rather than a bare top-level call: `fetchExperimentRows` needs to be
// importable from a test without running the whole CLI against a real
// database (see tests/persuade/experiment-report.test.ts).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
