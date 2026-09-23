/**
 * What each persuasion technique is actually doing, and on whom.
 *
 *   pnpm report:techniques [--min-runs=10]
 *
 * Derived from public.simulations every time it runs. Nothing here is stored:
 * a saved copy would drift the moment a run is re-scored, and this cannot
 * disagree with its own evidence.
 */
import { createClient } from '@supabase/supabase-js'
import {
  buildEffectiveness,
  distinctModelFingerprints,
  type EffectivenessInput,
  formatTechnique,
  unrecordedModels,
} from '../src/persuade/effectiveness'
import type { ArgumentCategory, PersuasionPlan } from '../src/persuade/engine/types'
import { env, readAll } from './lib/db'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const minRuns = Number(arg('min-runs') ?? '10')

  // Oldest first, and `id` as a tiebreaker, because the window moves between
  // requests: newest-first puts every insert the hourly worker makes mid-read
  // at offset 0 and shifts a row across the page boundary into being counted
  // twice, and rows sharing a `created_at` have no defined order at all
  // without a second key.
  const rows = await readAll((from, to) =>
    db
      .from('simulations')
      .select('outcome,turns,state,score,world,persona_id,plan,models,rules')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const inputs: EffectivenessInput[] = rows.map((row) => ({
    run: {
      outcome: row.outcome,
      turns: row.turns ?? [],
      score: row.score ?? null,
      world: row.world ?? null,
      personaId: row.persona_id,
      fatigue: row.state?.fatigue ?? 0,
      models: row.models ?? null,
      // A sweep can carry its own RuleConfig (queueSweep's `rules` override),
      // not only an experiment arm, so this cannot be inferred from
      // `experiment`/`variant` -- it has to be read off the row itself.
      fatigueThreshold: row.rules?.fatigueThreshold ?? null,
    },
    // What the plan actually put on the table. A technique the plan never
    // offered cannot be credited or blamed for the outcome.
    offered: ((row.plan as PersuasionPlan | null)?.arguments ?? []).map(
      (a) => a.category,
    ) as ArgumentCategory[],
  }))

  const withWorld = inputs.filter((i) => i.run.world)
  const worldless = inputs.filter((i) => !i.run.world)

  /**
   * Runs from before worlds existed are a different experiment.
   *
   * They cannot appear in the by-reason breakdown at all -- there is no reason
   * on them -- so pooling them only moves the overall rate, and it moves it a
   * long way: the first eleven runs were four pre-world refusals and seven
   * world runs that agreed 86% of the time, which averaged to a number
   * describing neither.
   *
   * Default is world runs only when any exist. `--all` pools them back, and
   * says so, for anyone who wants the whole history.
   */
  const pool = process.argv.includes('--all')
  const used = pool || withWorld.length === 0 ? inputs : withWorld
  const reports = buildEffectiveness(used)

  console.log(`סימולציות בסך הכול: ${inputs.length}`)
  console.log(`  עם עולם: ${withWorld.length}   בלי: ${worldless.length}`)
  if (withWorld.length === 0) {
    console.log('\nבלי עולם אין פילוח לפי סיבה. הרץ sweep כדי לקבל אחד.')
  } else if (pool) {
    console.log(
      `\nמוצג: הכול (${inputs.length}). הריצות בלי עולם מגיעות מהגדרה אחרת ומושכות את הממוצע.`,
    )
  } else if (worldless.length > 0) {
    console.log(
      `\nמוצג: ${withWorld.length} הריצות עם עולם בלבד. ` +
        `${worldless.length} ריצות ישנות הושמטו — הן מהגדרה אחרת ואין להן סיבה. ל--all כדי לכלול.`,
    )
  }

  // A win rate credits the message, and the message came from a specific
  // persuader model. Two persuader models pooled into one technique's win
  // rate is the same failure readiness() already refuses to call clean for
  // an A/B comparison -- two arms on different models are two experiments.
  const teachers = distinctModelFingerprints(used)
  if (teachers > 1) {
    console.log(
      `\nשים לב: הריצות המוצגות מגיעות מ-${teachers} צירופי מודלים שונים — ` +
        'ההשוואה בין הטכניקות עלולה למדוד את החלפת המודל ולא את הטכניקה.',
    )
  }
  const unrecorded = unrecordedModels(used)
  if (unrecorded > 0) {
    console.log(
      `\nשים לב: ל-${unrecorded} מהריצות המוצגות לא נרשמו מודלים — ` +
        'ייתכן שהן מאותו צירוף וייתכן שלא.',
    )
  }
  console.log('')

  if (reports.length === 0) {
    console.log('אין עדיין מספיק ריצות כדי לומר משהו.')
    return
  }

  for (const report of reports) {
    console.log(formatTechnique(report, minRuns))
    console.log(`\n${'─'.repeat(52)}\n`)
  }
}

await main()
