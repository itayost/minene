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
import { createClient } from '@supabase/supabase-js'
import {
  buildEffectiveness,
  type EffectivenessInput,
  formatTechnique,
} from '../src/persuade/effectiveness'
import type { ArgumentCategory, PersuasionPlan } from '../src/persuade/engine/types'

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

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const minRuns = Number(arg('min-runs') ?? '10')

  const { data, error } = await db
    .from('simulations')
    .select('outcome,turns,state,score,world,persona_id,plan')
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`)

  const inputs: EffectivenessInput[] = (data ?? []).map((row) => ({
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

  const reports = buildEffectiveness(inputs)

  console.log(`סימולציות: ${inputs.length}`)
  const withWorld = inputs.filter((i) => i.run.world).length
  console.log(`מתוכן עם עולם מוגדר: ${withWorld}`)
  if (withWorld === 0) {
    console.log('\nבלי עולם אין פילוח לפי סיבה. הרץ sweep כדי לקבל אחד.')
  }
  console.log('')

  if (reports.length === 0) {
    console.log('אין עדיין מספיק ריצות כדי לומר משהו.')
    return
  }

  for (const report of reports) {
    console.log(formatTechnique(report, minRuns))
    console.log('\n' + '─'.repeat(52) + '\n')
  }
}

await main()
