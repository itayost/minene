import type { SupabaseClient } from '@supabase/supabase-js'
import { NoObjectGeneratedError } from 'ai'
import type { PersuasionPlan, TargetPersona } from '../engine/types'
import { createUsageMeter, type TokenCount, withUsageMeter } from '../engine/usage'
import {
  COMMON_WORD_NAMES,
  mentionsName,
  personaProblems,
  planProblems,
} from './lab-content-checks'
import {
  generatePersona,
  generatePlan,
  personaKeyFor,
  planKeyFor,
  type RoleNeed,
  type RoleRef,
  requesterFor,
} from './lab-generator'
import { runPool } from './pool'

/**
 * `pnpm lab:generate`: role_needs in, validated personas and plans out.
 *
 * Plans are written before personas. A persona named after something already
 * said in a plan -- this run's plans included -- is a name no simulation can
 * use, so plans go first and personas are checked against all of them, read
 * fresh after the plan phase. Each persona key gets a few tries: a rejection
 * for a name reason alone (taken, mentioned in a plan, or a common Hebrew
 * word) adds that name to the avoid list and asks again, rather than losing
 * the whole role to one bad draw.
 *
 * Reads role_needs and the two lab tables. It never reads rules, roles,
 * documents or profiles, which belong to a business; the tenant boundary test
 * holds this file to that.
 */

const KEY_PATTERN = /^[a-z0-9-]+$/
const TITLE_MAX = 120
const JOB_ROLE_MAX = 40
const MAX_PERSONA_ATTEMPTS = 3

export interface GenerateOptions {
  industry?: string
  force: boolean
  concurrency?: number
}

export interface Rejection {
  key: string
  problems: string[]
}

export interface GenerateReport {
  written: string[]
  skipped: string[]
  rejected: Rejection[]
  /**
   * What the run cost in planner tokens.
   *
   * Generation is the largest single spend this project makes -- 181 plans and
   * personas emptied a balance without leaving a trace -- and nothing recorded
   * it, because token counting was wired into the simulation worker and not
   * here. Reported rather than stored: a run is a one-off a person watches.
   */
  usage: TokenCount
}

/**
 * What one phase produced. The usage total belongs to the run as a whole, so
 * only generateLabContent reports it.
 */
type PhaseReport = Omit<GenerateReport, 'usage'>

export interface GeneratorDeps {
  generatePlan: (need: RoleNeed, requester: string) => Promise<PersuasionPlan>
  generatePersona: (
    role: RoleRef,
    index: 1 | 2,
    avoidNames: readonly string[],
  ) => Promise<TargetPersona>
  now: () => Date
}

const DEFAULT_DEPS: GeneratorDeps = { generatePlan, generatePersona, now: () => new Date() }

interface RoleNeedRow {
  industry: string
  role_slug: string
  role_label: string
  role_order: number
  need_key: string
  need_label: string
  meta_need: string
}

const describeError = (cause: unknown): string => {
  // NoObjectGeneratedError's own message does not say why: appending the finish
  // reason makes a truncation at the output cap (`finishReason: 'length'`)
  // visible instead of looking like an ordinary parse failure.
  if (NoObjectGeneratedError.isInstance(cause)) {
    return `${cause.message} (finishReason: ${cause.finishReason})`
  }
  return cause instanceof Error ? cause.message : 'שגיאה לא ידועה'
}

const LAB_TABLES = ['persuasion_personas', 'persuasion_lab_plans'] as const

/**
 * Fails loudly, before any paid call, when the migration that adds `source`
 * and `generated_at` has not been applied yet.
 *
 * Without this, a run against an un-migrated project would call the model for
 * every item and only discover the missing columns at the first upsert --
 * paying for generation whose result could never be stored.
 */
async function assertLabColumnsExist(client: SupabaseClient): Promise<void> {
  for (const table of LAB_TABLES) {
    const { error } = await client.from(table).select('source,generated_at').limit(1)
    if (error) {
      throw new Error(
        `חסרות העמודות source ו-generated_at ב-${table}. צריך להחיל את המיגרציה לפני שמייצרים: ${error.message}`,
      )
    }
  }
}

async function readRoleNeeds(
  client: SupabaseClient,
  industry: string | undefined,
): Promise<RoleNeed[]> {
  const { data, error } = await client
    .from('role_needs')
    .select('industry,role_slug,role_label,role_order,need_key,need_label,meta_need')
    .order('role_order')
  if (error) throw new Error(`קריאת role_needs נכשלה: ${error.message}`)

  // Filtered here rather than in the query: 80 rows, and one query shape is one
  // thing to fake in a test.
  return ((data ?? []) as RoleNeedRow[])
    .filter((row) => industry === undefined || row.industry === industry)
    .map((row) => ({
      industry: row.industry,
      roleSlug: row.role_slug,
      roleLabel: row.role_label,
      roleOrder: row.role_order,
      needKey: row.need_key,
      needLabel: row.need_label,
      metaNeed: row.meta_need,
    }))
    .sort(
      (a, b) =>
        a.industry.localeCompare(b.industry) ||
        a.roleOrder - b.roleOrder ||
        a.needKey.localeCompare(b.needKey),
    )
}

async function readPersonaNames(client: SupabaseClient): Promise<Map<string, string>> {
  const { data, error } = await client
    .from('persuasion_personas')
    .select('persona_key,name')
    .order('persona_key')
  if (error) throw new Error(`קריאת הדמויות נכשלה: ${error.message}`)
  return new Map(
    ((data ?? []) as { persona_key: string; name: string }[]).map((row) => [
      row.persona_key,
      row.name,
    ]),
  )
}

async function readPlans(client: SupabaseClient): Promise<Map<string, PersuasionPlan>> {
  const { data, error } = await client
    .from('persuasion_lab_plans')
    .select('plan_key,plan')
    .order('plan_key')
  if (error) throw new Error(`קריאת התוכניות נכשלה: ${error.message}`)
  return new Map(
    ((data ?? []) as { plan_key: string; plan: PersuasionPlan }[]).map((row) => [
      row.plan_key,
      row.plan,
    ]),
  )
}

function rolesOf(needs: readonly RoleNeed[]): RoleRef[] {
  const seen = new Map<string, RoleRef>()
  for (const need of needs) {
    const id = `${need.industry}:${need.roleSlug}`
    if (!seen.has(id)) {
      seen.set(id, {
        industry: need.industry,
        roleSlug: need.roleSlug,
        roleLabel: need.roleLabel,
        roleOrder: need.roleOrder,
      })
    }
  }
  return [...seen.values()]
}

function keyAndRoleProblems(key: string, roleLabel: string): string[] {
  const problems: string[] = []
  if (!KEY_PATTERN.test(key)) problems.push(`מפתח לא תקין: ${key}`)
  if (roleLabel.trim().length > JOB_ROLE_MAX)
    problems.push(`שם התפקיד ארוך מ-${JOB_ROLE_MAX} תווים`)
  return problems
}

/**
 * Name-reason problems for one generated persona, checked separately from
 * `personaProblems`: these are the only reasons `generateOnePersona` retries,
 * because a different name can fix all three and nothing else can.
 */
function personaNameProblems(
  persona: TargetPersona,
  takenByOthers: readonly string[],
  planBlobs: readonly string[],
): string[] {
  const problems: string[] = []
  if (takenByOthers.includes(persona.name)) {
    problems.push(`השם "${persona.name}" כבר שייך לדמות אחרת`)
  }
  if (planBlobs.some((blob) => mentionsName(blob, persona.name))) {
    problems.push(`השם "${persona.name}" מופיע בתוכנית קיימת`)
  }
  if (COMMON_WORD_NAMES.has(persona.name)) {
    problems.push(`השם "${persona.name}" הוא גם מילה נפוצה`)
  }
  return problems
}

/**
 * Generates and writes one persona, retrying up to `MAX_PERSONA_ATTEMPTS`
 * times when a rejection is a name problem alone -- a different name is a
 * different draw, worth asking the model for again. Any other rejection, or a
 * thrown error, stops immediately: retrying would not change the outcome.
 */
async function generateOnePersona(
  client: SupabaseClient,
  role: RoleRef,
  index: 1 | 2,
  key: string,
  names: Map<string, string>,
  planBlobs: readonly string[],
  deps: GeneratorDeps,
): Promise<Rejection> {
  // Every name but this key's own, so a regenerated persona may keep its name.
  const takenByOthers = [...names.entries()]
    .filter(([other]) => other !== key)
    .map(([, name]) => name)
  const avoidedThisKey: string[] = []

  for (let attempt = 1; attempt <= MAX_PERSONA_ATTEMPTS; attempt += 1) {
    const avoidNames = [...new Set([...takenByOthers, ...COMMON_WORD_NAMES, ...avoidedThisKey])]

    let persona: TargetPersona
    try {
      persona = await deps.generatePersona(role, index, avoidNames)
    } catch (cause) {
      return { key, problems: [describeError(cause)] }
    }

    const otherProblems = [...personaProblems(persona), ...keyAndRoleProblems(key, role.roleLabel)]
    const nameProblems = personaNameProblems(persona, takenByOthers, planBlobs)

    if (otherProblems.length === 0 && nameProblems.length === 0) {
      const { error } = await client.from('persuasion_personas').upsert(
        {
          persona_key: key,
          industry: role.industry,
          job_role_name: role.roleLabel,
          name: persona.name,
          role: role.roleLabel,
          resistance: persona.resistance,
          reliability: persona.reliability,
          situation: persona.situation,
          hidden_truth: persona.hiddenTruth,
          motivated_by: persona.motivatedBy,
          style: persona.style,
          agrees_when: persona.agreesWhen,
          is_active: true,
          source: 'generated',
          generated_at: deps.now().toISOString(),
        },
        { onConflict: 'persona_key' },
      )
      if (error) return { key, problems: [`שמירה נכשלה: ${error.message}`] }

      names.set(key, persona.name)
      return { key, problems: [] }
    }

    const nameOnly = otherProblems.length === 0 && nameProblems.length > 0
    if (nameOnly && attempt < MAX_PERSONA_ATTEMPTS) {
      avoidedThisKey.push(persona.name)
      continue
    }

    return { key, problems: [...otherProblems, ...nameProblems] }
  }

  // Unreachable: the loop above always returns by its last iteration.
  throw new Error('generateOnePersona: no attempt returned')
}

async function generatePersonas(
  client: SupabaseClient,
  roles: readonly RoleRef[],
  options: GenerateOptions,
  deps: GeneratorDeps,
): Promise<PhaseReport> {
  // Read after the plan phase, so this run's own plans are checked too: a
  // persona named after something this run's plan just said must be caught,
  // not just a name from a plan that already existed.
  const [names, plans] = await Promise.all([readPersonaNames(client), readPlans(client)])
  const planBlobs = [...plans.values()].map((plan) => JSON.stringify(plan))
  const written: string[] = []
  const skipped: string[] = []
  const rejected: Rejection[] = []

  for (const role of roles) {
    for (const index of [1, 2] as const) {
      const key = personaKeyFor(role, index)
      if (names.has(key) && !options.force) {
        skipped.push(key)
        continue
      }

      const outcome = await generateOnePersona(client, role, index, key, names, planBlobs, deps)
      if (outcome.problems.length > 0) rejected.push(outcome)
      else written.push(key)
    }
  }

  return { written, skipped, rejected }
}

async function generatePlans(
  client: SupabaseClient,
  needs: readonly RoleNeed[],
  options: GenerateOptions,
  deps: GeneratorDeps,
): Promise<PhaseReport> {
  // Plans run before personas exist for this run, so only personas that
  // already existed before this run are checked here. That is deliberate: a
  // plan cannot see a name its own run has not generated yet, and personas
  // are checked against plans (including this run's) afterwards instead.
  const [names, plans] = await Promise.all([readPersonaNames(client), readPlans(client)])
  const personaNames = [...names.values()]

  const todo = needs.filter((need) => options.force || !plans.has(planKeyFor(need)))
  const skipped = needs.filter((need) => !todo.includes(need)).map(planKeyFor)

  const outcomes = await runPool(
    todo,
    options.concurrency ?? 4,
    async (need): Promise<Rejection> => {
      const key = planKeyFor(need)
      try {
        const plan = await deps.generatePlan(need, requesterFor(need, needs))
        const problems = [
          ...planProblems(plan, personaNames),
          ...keyAndRoleProblems(key, need.roleLabel),
        ]
        if (problems.length > 0) return { key, problems }

        const { error } = await client.from('persuasion_lab_plans').upsert(
          {
            plan_key: key,
            industry: need.industry,
            job_role_name: need.roleLabel,
            title: `${need.needLabel}: ${plan.topic}`.slice(0, TITLE_MAX),
            plan,
            is_active: true,
            source: 'generated',
            generated_at: deps.now().toISOString(),
          },
          { onConflict: 'plan_key' },
        )
        return error ? { key, problems: [`שמירה נכשלה: ${error.message}`] } : { key, problems: [] }
      } catch (cause) {
        return { key, problems: [describeError(cause)] }
      }
    },
  )

  return {
    written: outcomes
      .filter((outcome) => outcome.problems.length === 0)
      .map((outcome) => outcome.key),
    skipped,
    rejected: outcomes.filter((outcome) => outcome.problems.length > 0),
  }
}

export async function generateLabContent(
  client: SupabaseClient,
  options: GenerateOptions,
  deps: GeneratorDeps = DEFAULT_DEPS,
): Promise<GenerateReport> {
  // Before any paid call: a project the migration has not reached yet would
  // otherwise generate everything and fail only at the first write.
  await assertLabColumnsExist(client)

  const needs = await readRoleNeeds(client, options.industry)
  if (needs.length === 0) {
    throw new Error(
      options.industry
        ? `אין צרכים ב-role_needs לענף "${options.industry}"`
        : 'אין צרכים ב-role_needs',
    )
  }

  // Plans first: a persona named after something a plan says -- this run's
  // plans included -- is checked against the plans, not the other way round.
  // One meter for the whole run: every generator call happens inside this
  // scope, so neither phase has to thread a counter through itself.
  const meter = createUsageMeter()
  const { plans, personas } = await withUsageMeter(meter, async () => {
    const generatedPlans = await generatePlans(client, needs, options, deps)
    const generatedPersonas = await generatePersonas(client, rolesOf(needs), options, deps)
    return { plans: generatedPlans, personas: generatedPersonas }
  })

  return {
    written: [...plans.written, ...personas.written],
    skipped: [...plans.skipped, ...personas.skipped],
    rejected: [...plans.rejected, ...personas.rejected],
    usage: meter.totals().planner,
  }
}
