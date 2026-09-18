/**
 * Checks the lab's personas and plans against the invariants that used to be
 * unit tests over `content/*.json`.
 *
 * They stopped being testable that way when the content moved into the
 * database: a unit test cannot reach a row, and a test that skips itself when
 * no database is configured reports green while checking nothing. So they run
 * here, and the rules themselves live in src/persuade/lib/lab-content-checks.ts,
 * where the generator uses them before it writes anything.
 *
 *   pnpm validate:lab
 */
import { createClient } from '@supabase/supabase-js'
import type { PersuasionPlan } from '../src/persuade/engine/types'
import { personaProblems, planProblems } from '../src/persuade/lib/lab-content-checks'
import { env } from './lib/db'

interface PersonaRow {
  persona_key: string
  name: string
  role: string
  situation: string
  hidden_truth: string
  style: string
  agrees_when: string
}

interface PlanRow {
  plan_key: string
  plan: PersuasionPlan
}

async function main(): Promise<void> {
  const { url, key } = env()
  const db = createClient(url, key, { auth: { persistSession: false } })
  const problems: string[] = []

  const { data: personaData, error: personaError } = await db
    .from('persuasion_personas')
    .select('persona_key,name,role,situation,hidden_truth,style,agrees_when')
    .eq('is_active', true)
  if (personaError) throw new Error(`קריאת הדמויות נכשלה: ${personaError.message}`)

  const { data: planData, error: planError } = await db
    .from('persuasion_lab_plans')
    .select('plan_key,plan')
    .eq('is_active', true)
  if (planError) throw new Error(`קריאת התוכניות נכשלה: ${planError.message}`)

  const personas = (personaData ?? []) as PersonaRow[]
  const plans = (planData ?? []) as PlanRow[]

  if (personas.length === 0) problems.push('אין אף דמות פעילה')
  if (plans.length === 0) problems.push('אין אף תוכנית פעילה')

  for (const row of personas) {
    const found = personaProblems({
      name: row.name,
      role: row.role,
      situation: row.situation,
      hiddenTruth: row.hidden_truth,
      style: row.style,
      agreesWhen: row.agrees_when,
    })
    for (const problem of found) problems.push(`${row.persona_key}: ${problem}`)
  }

  const names = personas.map((row) => row.name)
  for (const row of plans) {
    for (const problem of planProblems(row.plan, names))
      problems.push(`${row.plan_key}: ${problem}`)
  }

  const keys = plans.map((row) => row.plan_key)
  if (new Set(keys).size !== keys.length) problems.push('יש מפתחות תוכנית כפולים')

  if (problems.length > 0) {
    console.error('תוכן המעבדה לא תקין:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exit(1)
  }

  console.log(`תוכן המעבדה תקין: ${personas.length} דמויות, ${plans.length} תוכניות.`)
}

await main()
