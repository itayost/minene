import type { SupabaseClient } from '@supabase/supabase-js'
import type { PersuasionPlan, TargetPersona } from '../engine/types'
import { mentionsName, personaProblems, planProblems } from './lab-content-checks'
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
 * Personas are written before plans, one at a time, so every plan is checked
 * against every persona name that will exist when it runs, and so no two new
 * personas share a name. Plans are independent of each other and run a few at
 * a time.
 *
 * Reads role_needs and the two lab tables. It never reads rules, roles,
 * documents or profiles, which belong to a business; the tenant boundary test
 * holds this file to that.
 */

const KEY_PATTERN = /^[a-z0-9-]+$/
const TITLE_MAX = 120
const JOB_ROLE_MAX = 40

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
}

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

const describeError = (cause: unknown): string =>
  cause instanceof Error ? cause.message : 'שגיאה לא ידועה'

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

async function generatePersonas(
  client: SupabaseClient,
  roles: readonly RoleRef[],
  options: GenerateOptions,
  deps: GeneratorDeps,
): Promise<GenerateReport> {
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

      // Every name but this key's own, so a regenerated persona may keep its name.
      const taken = [...names.entries()].filter(([other]) => other !== key).map(([, name]) => name)

      try {
        const persona = await deps.generatePersona(role, index, taken)
        const problems = [...personaProblems(persona), ...keyAndRoleProblems(key, role.roleLabel)]
        if (taken.includes(persona.name)) problems.push(`השם "${persona.name}" כבר שייך לדמות אחרת`)
        if (planBlobs.some((blob) => mentionsName(blob, persona.name))) {
          problems.push(`השם "${persona.name}" מופיע בתוכנית קיימת`)
        }
        if (problems.length > 0) {
          rejected.push({ key, problems })
          continue
        }

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
        if (error) {
          rejected.push({ key, problems: [`שמירה נכשלה: ${error.message}`] })
          continue
        }

        names.set(key, persona.name)
        written.push(key)
      } catch (cause) {
        rejected.push({ key, problems: [describeError(cause)] })
      }
    }
  }

  return { written, skipped, rejected }
}

async function generatePlans(
  client: SupabaseClient,
  needs: readonly RoleNeed[],
  options: GenerateOptions,
  deps: GeneratorDeps,
): Promise<GenerateReport> {
  // Read after the personas are written, so this run's names are checked too.
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
  const needs = await readRoleNeeds(client, options.industry)
  if (needs.length === 0) {
    throw new Error(
      options.industry
        ? `אין צרכים ב-role_needs לענף "${options.industry}"`
        : 'אין צרכים ב-role_needs',
    )
  }

  const personas = await generatePersonas(client, rolesOf(needs), options, deps)
  const plans = await generatePlans(client, needs, options, deps)

  return {
    written: [...personas.written, ...plans.written],
    skipped: [...personas.skipped, ...plans.skipped],
    rejected: [...personas.rejected, ...plans.rejected],
  }
}
