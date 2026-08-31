/**
 * Exports stored simulations as a fine-tuning set.
 *
 *   pnpm export:dataset [outfile] [--min-grade=70] [--allow-dirty]
 *
 * Reads public.simulations and never public.conversations. A simulation is an
 * invented scenario against a synthetic persona; a conversation is a real
 * exchange with a named employee about their own performance, and it does not
 * belong in a training file however good it was.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import type { Recipient } from '../src/persuade/engine/prompts'
import { getPersona } from '../src/persuade/lib/content'
import { buildDataset, sourceRunsFromRows, toJsonl } from '../src/persuade/lib/dataset'

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

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })

  const outfile = process.argv[2]?.startsWith('--')
    ? 'train.jsonl'
    : (process.argv[2] ?? 'train.jsonl')
  const minGrade = Number(arg('min-grade') ?? '70')
  const requireCleanTurns = !process.argv.includes('--allow-dirty')

  const { data, error } = await db
    .from('simulations')
    .select('id,created_at,plan,persona_id,turns,state,score,rules,models,experiment,variant')
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) throw new Error(`קריאת הסימולציות נכשלה: ${error.message}`)

  const rows = data ?? []

  // runSimulation always hands the persuader the real persona as its
  // recipient, so the replay needs the same name and role back -- not the
  // key alone. Resolved once per distinct persona rather than per row, since
  // a sweep runs the same few personas thousands of times.
  const personaIds = [...new Set(rows.map((r) => r.persona_id).filter((id) => id !== null))]
  const personas = new Map<string, Recipient>()
  for (const id of personaIds) {
    try {
      const persona = await getPersona(id)
      personas.set(id, { name: persona.name, role: persona.role })
    } catch {
      // A persona a very old run pointed at can be gone entirely. Its rows
      // are not exported: they still had a real recipient at generation time,
      // so stating "no recipient" for them (see dataset.ts's
      // `persona-unresolvable` rejection) would be the same contradiction the
      // recipient fix removed, not a harmless fallback.
    }
  }

  const sources = sourceRunsFromRows(rows, personas)

  const { examples, rejected } = buildDataset(sources, { minGrade, requireCleanTurns })

  console.log(`סימולציות שנקראו: ${rows.length}`)
  console.log(`דוגמאות אימון: ${examples.length}`)
  if (Object.keys(rejected).length > 0) {
    console.log('נפסלו:')
    for (const [reason, count] of Object.entries(rejected).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count.toString().padStart(5)}  ${reason}`)
    }
  }

  // A model swap invalidates a comparison; for a training set it is milder but
  // still worth seeing, since examples from two different teachers are two
  // different behaviours being averaged.
  const teachers = new Set(rows.map((r) => JSON.stringify(r.models ?? null)))
  if (teachers.size > 1) {
    console.log(`\nשים לב: הדוגמאות מגיעות מ-${teachers.size} צירופי מודלים שונים.`)
  }

  if (examples.length === 0) {
    console.log('\nאין מה לכתוב.')
    return
  }

  writeFileSync(outfile, `${toJsonl(examples)}\n`, 'utf8')
  console.log(`\nנכתב: ${outfile}`)
}

await main()
