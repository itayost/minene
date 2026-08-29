/**
 * What each persuasion technique is actually doing, and on whom.
 *
 *   pnpm report:techniques [--min-runs=10]
 *
 * Derived from public.simulations every time it runs. Nothing here is stored:
 * a saved copy would drift the moment a run is re-scored, and this cannot
 * disagree with its own evidence.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  buildEffectiveness,
  type EffectivenessInput,
  formatTechnique,
} from '../src/persuade/effectiveness'
import type {
  ArgumentCategory,
  Outcome,
  PersuasionPlan,
  RunScore,
  Turn,
} from '../src/persuade/engine/types'
import type { WorldState } from '../src/persuade/engine/world'
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

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

export interface SimulationRow {
  outcome: Outcome
  turns: Turn[] | null
  state: { fatigue?: number } | null
  score: RunScore | null
  world: WorldState | null
  persona_id: string | null
  plan: PersuasionPlan | null
}

/**
 * Every simulation, not the most recent 5000 of them.
 *
 * A fixed `.limit()` reads as a deliberate bound, but there was no note anyone
 * chose 5000 on purpose, and ordering by `created_at desc` first means growth
 * past it quietly drops the OLDEST evidence -- so the report keeps looking
 * complete right up until the day it silently stops being one. See
 * `fetchAll` for why a plain `.select()` has the same failure mode.
 */
export async function fetchSimulationRows(db: SupabaseClient): Promise<SimulationRow[]> {
  return fetchAll<SimulationRow>((from, to) =>
    db
      .from('simulations')
      .select('outcome,turns,state,score,world,persona_id,plan')
      .order('created_at', { ascending: false })
      .range(from, to),
  )
}

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const minRuns = Number(arg('min-runs') ?? '10')

  const data = await fetchSimulationRows(db)

  const inputs: EffectivenessInput[] = data.map((row) => ({
    run: {
      outcome: row.outcome,
      turns: row.turns ?? [],
      score: row.score ?? null,
      world: row.world ?? null,
      personaId: row.persona_id,
      fatigue: row.state?.fatigue ?? 0,
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

// Guarded so a test can import fetchSimulationRows without running the whole
// script against a real database.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
