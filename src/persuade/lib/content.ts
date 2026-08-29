import type { PersuasionPlan, TargetPersona } from '../engine/types'
import { supabase } from './supabase'

/**
 * The lab's inputs: the personas it argues against and the plans it argues for.
 *
 * These were committed JSON under `content/`, read from disk and cached, and
 * that had one real virtue this file no longer has: "a batch run a week later
 * differs because the engine changed, not because the inputs were
 * regenerated." A stored persona can be edited between two runs, so two runs
 * are no longer strictly comparable unless someone checks.
 *
 * Traded on purpose, for two things. A persona can be added without a deploy.
 * And the inputs are now keyed by the same axis the outputs already were --
 * `public.simulations` records every run under (industry, job_role_id, need),
 * while its inputs were one flat folder with no way to say which persona
 * belonged to which cell of the matrix the lab draws.
 *
 * The files remain in git history as the origin record; the seed in
 * `20260829100100_add_lab_content.sql` is what was in them.
 */

interface PersonaRow {
  persona_key: string
  name: string
  role: string
  resistance: number
  reliability: number
  situation: string
  hidden_truth: string
  motivated_by: string[] | null
  style: string
  agrees_when: string
}

interface PlanRow {
  plan_key: string
  plan: PersuasionPlan
}

const PERSONA_COLUMNS =
  'persona_key,name,role,resistance,reliability,situation,hidden_truth,motivated_by,style,agrees_when'

/**
 * `resistance` and `reliability` are 1-5 unions in the type and plain ints in
 * the database, which is a check constraint away from agreeing and a cast away
 * from compiling. The constraint is the real guarantee; this is the seam where
 * the two vocabularies meet.
 */
const toPersona = (row: PersonaRow): TargetPersona => ({
  id: row.persona_key,
  name: row.name,
  role: row.role,
  resistance: row.resistance as TargetPersona['resistance'],
  reliability: row.reliability as TargetPersona['reliability'],
  situation: row.situation,
  hiddenTruth: row.hidden_truth,
  motivatedBy: row.motivated_by ?? [],
  style: row.style,
  agreesWhen: row.agrees_when,
})

export async function loadPersonas(): Promise<TargetPersona[]> {
  const { data, error } = await supabase()
    .from('persuasion_personas')
    .select(PERSONA_COLUMNS)
    .eq('is_active', true)
    .order('persona_key')

  if (error) throw new Error(`קריאת הדמויות נכשלה: ${error.message}`)
  return (data as unknown as PersonaRow[]).map(toPersona)
}

export async function loadPlans(): Promise<PersuasionPlan[]> {
  const { data, error } = await supabase()
    .from('persuasion_lab_plans')
    .select('plan_key,plan')
    .eq('is_active', true)
    .order('plan_key')

  if (error) throw new Error(`קריאת התוכניות נכשלה: ${error.message}`)
  // The stored jsonb is the engine's own PersuasionPlan. plan_key is the handle
  // a run is recorded under, and the plan's own `id` is what the engine uses,
  // so the key is asserted over it rather than trusted to match.
  return (data as unknown as PlanRow[]).map((row) => ({ ...row.plan, id: row.plan_key }))
}

/**
 * Retired personas stay readable.
 *
 * A stored run references `persona_key`, so a lookup by id must find a persona
 * that is no longer offered in the picker -- otherwise re-reading last month's
 * simulation fails on a persona somebody deactivated since.
 */
export async function getPersona(id: string): Promise<TargetPersona> {
  const { data, error } = await supabase()
    .from('persuasion_personas')
    .select(PERSONA_COLUMNS)
    .eq('persona_key', id)
    .maybeSingle()

  if (error) throw new Error(`קריאת הדמות נכשלה: ${error.message}`)
  if (!data) throw new Error(`לא נמצא דמות בשם "${id}"`)
  return toPersona(data as unknown as PersonaRow)
}

export async function getPlan(id: string): Promise<PersuasionPlan> {
  const { data, error } = await supabase()
    .from('persuasion_lab_plans')
    .select('plan_key,plan')
    .eq('plan_key', id)
    .maybeSingle()

  if (error) throw new Error(`קריאת התוכנית נכשלה: ${error.message}`)
  if (!data) throw new Error(`לא נמצא תוכנית בשם "${id}"`)
  const row = data as unknown as PlanRow
  return { ...row.plan, id: row.plan_key }
}

/**
 * What the lab's persona picker gets: enough to read an option, and nothing
 * else. `hiddenTruth` is what the target knows and the persuader has to work
 * out, and the lab page is a server component -- handing the client a whole
 * persona would print the answer to every simulation into the page source.
 *
 * Selected narrowly rather than mapped down from a full row, so the secret is
 * never fetched at all on this path.
 */
export async function listPersonaOptions(): Promise<Pick<TargetPersona, 'id' | 'name' | 'role'>[]> {
  const { data, error } = await supabase()
    .from('persuasion_personas')
    .select('persona_key,name,role')
    .eq('is_active', true)
    .order('persona_key')

  if (error) throw new Error(`קריאת הדמויות נכשלה: ${error.message}`)
  return (data as { persona_key: string; name: string; role: string }[]).map((row) => ({
    id: row.persona_key,
    name: row.name,
    role: row.role,
  }))
}
