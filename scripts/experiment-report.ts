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
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Outcome } from '../src/persuade/engine/types'
import { compareArms, type ExperimentRun, readiness } from '../src/persuade/experiment-results'
import { fetchAll } from '../src/persuade/lib/fetch-all'

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

export interface ExperimentSimulationRow {
  experiment: string
  variant: string | null
  outcome: Outcome
  turns: ExperimentRun['turns'] | null
  score: ExperimentRun['score']
  models: ExperimentRun['models']
}

/**
 * Every run that belongs to an experiment, not just the first page of them.
 *
 * There was no `.limit()` at all here, which is worse than technique-report's:
 * an un-ranged `.select()` is capped by PostgREST's own default (1000 rows on
 * a stock Supabase project) rather than by anything this file chose, so the
 * truncation point isn't even visible by reading this code. See `fetchAll`.
 */
export async function fetchExperimentRows(db: SupabaseClient): Promise<ExperimentSimulationRow[]> {
  return fetchAll<ExperimentSimulationRow>((from, to) =>
    db
      .from('simulations')
      .select('experiment,variant,outcome,turns,score,models')
      .not('experiment', 'is', null)
      .range(from, to),
  )
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

// Guarded so a test can import fetchExperimentRows without running the whole
// script against a real database.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
