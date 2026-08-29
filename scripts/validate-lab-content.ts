/**
 * Checks the lab's personas and plans against the invariants that used to be
 * unit tests over `content/*.json`.
 *
 * They stopped being testable that way when the content moved into the
 * database: a unit test cannot reach a row, and a test that skips itself when
 * no database is configured reports green while checking nothing. So they moved
 * here, alongside `validate:brands`, which this repo already runs the same way.
 *
 *   pnpm validate:lab
 *
 * Reads with the service key, so it runs from a machine with .env.local or from
 * anywhere SUPABASE_URL and SUPABASE_SECRET_KEY are set.
 */
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { isAskPhotographable } from '../src/persuade/engine/rules'
import type { PersuasionPlan } from '../src/persuade/engine/types'

function env(): { url: string; key: string } {
  // .env.local is not loaded for a plain tsx run, and reading it here is what
  // makes this runnable without a wrapper.
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
    // No file is fine when the variables are already in the environment.
  }
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) {
    throw new Error(
      'חסרים SUPABASE_URL ו-SUPABASE_SECRET_KEY. בלעדיהם אי אפשר לקרוא את תוכן המעבדה.',
    )
  }
  return { url, key }
}

/** Word boundaries matter: "ועדיין" contains "עדי" and is not a name. */
const standalone = (name: string) => new RegExp(`(?<![א-ת])${name}(?![א-ת])`)

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const problems: string[] = []

  const { data: personas, error: personaError } = await db
    .from('persuasion_personas')
    .select('persona_key,name,reliability,resistance,hidden_truth,agrees_when,industry')
    .eq('is_active', true)
  if (personaError) throw new Error(`קריאת הדמויות נכשלה: ${personaError.message}`)

  const { data: plans, error: planError } = await db
    .from('persuasion_lab_plans')
    .select('plan_key,plan,industry')
    .eq('is_active', true)
  if (planError) throw new Error(`קריאת התוכניות נכשלה: ${planError.message}`)

  if ((personas ?? []).length === 0) problems.push('אין אף דמות פעילה')
  if ((plans ?? []).length === 0) problems.push('אין אף תוכנית פעילה')

  for (const p of personas ?? []) {
    // The follow-up phase reads reliability; a persona without it cannot be
    // scored, and the constraint allows 1-5 rather than requiring it be set.
    if (!p.hidden_truth?.trim()) problems.push(`${p.persona_key}: אין אמת נסתרת`)
    if (!p.agrees_when?.trim()) problems.push(`${p.persona_key}: לא נאמר מתי היא מסכימה`)
  }

  for (const row of plans ?? []) {
    const plan = row.plan as PersuasionPlan
    const gate = isAskPhotographable(plan)
    if (!gate.ok) {
      problems.push(`${row.plan_key}: הבקשה לא ניתנת לצילום — חסר ${gate.missing.join(', ')}`)
    }
    const rungs = (plan.escalation ?? []).map((e) => e.rung)
    if (JSON.stringify(rungs) !== JSON.stringify([1, 2, 3, 4, 5])) {
      problems.push(`${row.plan_key}: סולם ההסלמה אינו חמש מדרגות (${rungs.join(',') || 'ריק'})`)
    }
    // A plan naming a persona makes every simulation against a different
    // persona incoherent, and the failure is silent -- the bot simply addresses
    // the wrong person.
    const blob = JSON.stringify(plan)
    for (const persona of personas ?? []) {
      if (standalone(persona.name).test(blob)) {
        problems.push(`${row.plan_key}: התוכנית מזכירה בשמה את הדמות "${persona.name}"`)
      }
    }
  }

  const keys = (plans ?? []).map((p) => p.plan_key)
  if (new Set(keys).size !== keys.length) problems.push('יש מפתחות תוכנית כפולים')

  if (problems.length > 0) {
    console.error('תוכן המעבדה לא תקין:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log(
    `תוכן המעבדה תקין: ${(personas ?? []).length} דמויות, ${(plans ?? []).length} תוכניות.`,
  )
}

await main()
