/**
 * @vitest-environment node
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { NoObjectGeneratedError } from 'ai'
import { describe, expect, test } from 'vitest'
import type { PersuasionPlan, TargetPersona } from '../../src/persuade/engine/types'
import { type GeneratorDeps, generateLabContent } from '../../src/persuade/lib/generate-lab-content'
import type { RoleNeed, RoleRef } from '../../src/persuade/lib/lab-generator'
import { TEST_PERSONA, TEST_PLAN } from './helpers'

type Row = Record<string, unknown>

/** Stores rows and answers exactly the reads and upserts the generator makes. */
function fakeClient(seed: {
  needs: Row[]
  personas?: Row[]
  plans?: Row[]
  failKey?: string
  failPreflightTable?: string
}) {
  const tables: Record<string, Row[]> = {
    role_needs: seed.needs,
    persuasion_personas: seed.personas ?? [],
    persuasion_lab_plans: seed.plans ?? [],
  }
  const touched = new Set<string>()
  const upserts: { table: string; row: Row; onConflict: string }[] = []

  const client = {
    from(table: string) {
      touched.add(table)
      return {
        select() {
          return {
            order: async () => ({ data: tables[table] ?? [], error: null }),
            limit: async () =>
              table === seed.failPreflightTable
                ? { data: null, error: { message: 'column "source" does not exist' } }
                : { data: tables[table] ?? [], error: null },
          }
        },
        async upsert(row: Row, options: { onConflict: string }) {
          upserts.push({ table, row, onConflict: options.onConflict })
          if (row[options.onConflict] === seed.failKey) return { error: { message: 'disk full' } }
          const current = tables[table] ?? []
          const at = current.findIndex((r) => r[options.onConflict] === row[options.onConflict])
          tables[table] = at >= 0 ? current.map((r, i) => (i === at ? row : r)) : [...current, row]
          return { error: null }
        },
      }
    },
  } as unknown as SupabaseClient

  return { client, touched, upserts }
}

const needRow = (
  roleSlug: string,
  roleOrder: number,
  needKey: string,
  industry = 'retail',
): Row => ({
  industry,
  role_slug: roleSlug,
  role_label: roleSlug === 'ceo' ? 'מנכ"ל' : 'מנהל חנות',
  role_order: roleOrder,
  need_key: needKey,
  need_label: `צורך ${needKey}`,
  meta_need: 'people',
})

const NOW = new Date('2026-09-17T12:00:00.000Z')

/** Scripted generators: plans are TEST_PLAN re-keyed, personas get the next name from a list. */
function deps(
  names: string[] = ['נועה', 'רון', 'מיכל', 'יונתן'],
  overrides: Partial<GeneratorDeps> = {},
) {
  const calls = {
    plans: [] as { key: string; requester: string }[],
    personas: [] as { key: string; avoid: readonly string[] }[],
    order: [] as ('plan' | 'persona')[],
  }
  let next = 0
  const value: GeneratorDeps = {
    generatePlan: async (need: RoleNeed, requester: string): Promise<PersuasionPlan> => {
      calls.order.push('plan')
      calls.plans.push({ key: `gen-${need.industry}-${need.roleSlug}-${need.needKey}`, requester })
      return {
        ...TEST_PLAN,
        id: `gen-${need.industry}-${need.roleSlug}-${need.needKey}`,
        onBehalfOf: { name: requester, title: requester, mandate: 'x' },
      }
    },
    generatePersona: async (
      role: RoleRef,
      index: 1 | 2,
      avoid: readonly string[],
    ): Promise<TargetPersona> => {
      calls.order.push('persona')
      calls.personas.push({ key: `gen-${role.industry}-${role.roleSlug}-${index}`, avoid })
      const name = names[next] ?? `שם${next}`
      next += 1
      return {
        ...TEST_PERSONA,
        id: `gen-${role.industry}-${role.roleSlug}-${index}`,
        name,
        role: role.roleLabel,
      }
    },
    now: () => NOW,
    ...overrides,
  }
  return { value, calls }
}

describe('generateLabContent', () => {
  test('writes two personas per role and one plan per need, marked as generated', async () => {
    const { client, upserts } = fakeClient({
      needs: [
        needRow('ceo', 1, 'growth'),
        needRow('store-manager', 4, 'training'),
        needRow('store-manager', 4, 'service'),
      ],
    })
    const { value, calls } = deps()

    const report = await generateLabContent(client, { force: false }, value)

    expect(report.rejected).toEqual([])
    expect(report.skipped).toEqual([])
    expect([...report.written].sort()).toEqual([
      'gen-retail-ceo-1',
      'gen-retail-ceo-2',
      'gen-retail-ceo-growth',
      'gen-retail-store-manager-1',
      'gen-retail-store-manager-2',
      'gen-retail-store-manager-service',
      'gen-retail-store-manager-training',
    ])

    const persona = upserts.find((u) => u.row.persona_key === 'gen-retail-store-manager-1')
    expect(persona?.onConflict).toBe('persona_key')
    expect(persona?.row).toMatchObject({
      industry: 'retail',
      job_role_name: 'מנהל חנות',
      role: 'מנהל חנות',
      is_active: true,
      source: 'generated',
      generated_at: NOW.toISOString(),
      hidden_truth: TEST_PERSONA.hiddenTruth,
      agrees_when: TEST_PERSONA.agreesWhen,
      motivated_by: TEST_PERSONA.motivatedBy,
    })

    const plan = upserts.find((u) => u.row.plan_key === 'gen-retail-store-manager-training')
    expect(plan?.onConflict).toBe('plan_key')
    expect(plan?.row).toMatchObject({
      industry: 'retail',
      job_role_name: 'מנהל חנות',
      title: `צורך training: ${TEST_PLAN.topic}`,
      is_active: true,
      source: 'generated',
      generated_at: NOW.toISOString(),
    })

    // The store manager (order 4) has no role at order 3 in this data.
    expect(calls.plans.find((c) => c.key === 'gen-retail-store-manager-training')?.requester).toBe(
      'הנהלת החברה',
    )
  })

  test('reads role_needs and the two lab tables, and nothing else', async () => {
    const { client, touched } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    await generateLabContent(client, { force: false }, deps().value)
    expect([...touched].sort()).toEqual([
      'persuasion_lab_plans',
      'persuasion_personas',
      'role_needs',
    ])
  })

  test('filters to one industry when asked', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth'), needRow('banker', 3, 'loans', 'bank')],
    })
    const report = await generateLabContent(
      client,
      { industry: 'bank', force: false },
      deps().value,
    )
    expect(report.written.every((key) => key.startsWith('gen-bank-'))).toBe(true)
    expect(report.written).toHaveLength(3)
  })

  test('skips keys that already exist unless forced', async () => {
    const seed = {
      needs: [needRow('ceo', 1, 'growth')],
      personas: [
        { persona_key: 'gen-retail-ceo-1', name: 'דנה' },
        { persona_key: 'gen-retail-ceo-2', name: 'גיל' },
      ],
      plans: [{ plan_key: 'gen-retail-ceo-growth', plan: TEST_PLAN }],
    }

    const skipping = fakeClient(seed)
    const first = await generateLabContent(skipping.client, { force: false }, deps().value)
    expect(first.written).toEqual([])
    expect([...first.skipped].sort()).toEqual([
      'gen-retail-ceo-1',
      'gen-retail-ceo-2',
      'gen-retail-ceo-growth',
    ])
    expect(skipping.upserts).toHaveLength(0)

    const forcing = fakeClient(seed)
    const second = await generateLabContent(forcing.client, { force: true }, deps().value)
    expect(second.skipped).toEqual([])
    expect(second.written).toHaveLength(3)
  })

  test('a regenerated persona may keep its own old name', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth')],
      personas: [{ persona_key: 'gen-retail-ceo-1', name: 'נועה' }],
    })
    const report = await generateLabContent(client, { force: true }, deps(['נועה', 'רון']).value)
    expect(report.rejected).toEqual([])
  })

  test('generates plans before any persona (plans-first order)', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth'), needRow('store-manager', 4, 'training')],
    })
    const scripted = deps()

    await generateLabContent(client, { force: false }, scripted.value)

    expect(scripted.calls.order[0]).toBe('plan')
    const lastPlanCall = scripted.calls.order.lastIndexOf('plan')
    const firstPersonaCall = scripted.calls.order.indexOf('persona')
    expect(firstPersonaCall).toBeGreaterThan(lastPlanCall)
  })

  test('a persona name that appears in a plan written this same run is retried and written with the next name', async () => {
    const { client, upserts } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    // TEST_PLAN's requester is אושר, kept unchanged so the plan really carries
    // it -- and it did not exist before this run, so only the plans-first
    // order (reading plans after they are written) catches it.
    const scripted = deps(['אושר', 'מיכל'], {
      generatePlan: async (need) => ({
        ...TEST_PLAN,
        id: `gen-${need.industry}-${need.roleSlug}-${need.needKey}`,
      }),
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(report.rejected).toEqual([])
    const attemptsForFirstPersona = scripted.calls.personas.filter(
      (c) => c.key === 'gen-retail-ceo-1',
    )
    expect(attemptsForFirstPersona).toHaveLength(2)
    expect(attemptsForFirstPersona[1]?.avoid).toContain('אושר')
    expect(upserts.find((u) => u.row.persona_key === 'gen-retail-ceo-1')?.row.name).toBe('מיכל')
  })

  test('a denylisted first name is retried', async () => {
    const { client, upserts } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    // רון is on COMMON_WORD_NAMES; עדי is not.
    const scripted = deps(['רון', 'עדי'])

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(report.rejected).toEqual([])
    expect(upserts.find((u) => u.row.persona_key === 'gen-retail-ceo-1')?.row.name).toBe('עדי')
  })

  test("after 3 name rejections the key is rejected with the last attempt's problems, not the first", async () => {
    const { client } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    const denylisted = ['שני', 'מתן', 'עמית'] // all three on COMMON_WORD_NAMES
    let attempts = 0
    const scripted = deps(undefined, {
      generatePersona: async (role, index) => {
        if (index === 2) {
          return {
            ...TEST_PERSONA,
            id: `gen-${role.industry}-${role.roleSlug}-${index}`,
            name: 'יונתן',
          }
        }
        const name = denylisted[attempts] as string
        attempts += 1
        return { ...TEST_PERSONA, id: `gen-${role.industry}-${role.roleSlug}-${index}`, name }
      },
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(attempts).toBe(3)
    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-1', problems: ['השם "עמית" הוא גם מילה נפוצה'] },
    ])
  })

  test('a name already taken by another persona is retried, then rejected with the last attempt if it persists', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth')],
      personas: [{ persona_key: 'adi', name: 'עדי' }],
    })
    let attempts = 0
    const scripted = deps(undefined, {
      generatePersona: async (role, index) => {
        if (index === 2) {
          return {
            ...TEST_PERSONA,
            id: `gen-${role.industry}-${role.roleSlug}-${index}`,
            name: 'יונתן',
          }
        }
        // A model that keeps offering the same taken name however many times it is asked.
        attempts += 1
        return {
          ...TEST_PERSONA,
          id: `gen-${role.industry}-${role.roleSlug}-${index}`,
          name: 'עדי',
        }
      },
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(attempts).toBe(3)
    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-1', problems: ['השם "עדי" כבר שייך לדמות אחרת'] },
    ])
  })

  test('a thrown model error rejects immediately without retrying', async () => {
    const { client } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    let attempts = 0
    const scripted = deps(undefined, {
      generatePersona: async (role, index) => {
        if (index === 2) {
          return {
            ...TEST_PERSONA,
            id: `gen-${role.industry}-${role.roleSlug}-${index}`,
            name: 'יונתן',
          }
        }
        attempts += 1
        throw new Error('rate limited')
      },
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(attempts).toBe(1)
    expect(report.rejected).toEqual([{ key: 'gen-retail-ceo-1', problems: ['rate limited'] }])
  })

  test('a NoObjectGeneratedError names the finish reason, so truncation at the output cap is visible', async () => {
    const { client } = fakeClient({ needs: [needRow('ceo', 1, 'growth')] })
    const scripted = deps(undefined, {
      generatePersona: async (role, index) => {
        if (index === 2) {
          return {
            ...TEST_PERSONA,
            id: `gen-${role.industry}-${role.roleSlug}-${index}`,
            name: 'יונתן',
          }
        }
        throw new NoObjectGeneratedError({
          message: 'No object generated: could not parse the response.',
          response: { id: 'r1', timestamp: new Date('2026-09-17T00:00:00Z'), modelId: 'm' },
          usage: {
            inputTokens: 10,
            inputTokenDetails: {
              noCacheTokens: 10,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
            },
            outputTokens: 5,
            outputTokenDetails: { textTokens: 5, reasoningTokens: 0 },
            totalTokens: 15,
          },
          finishReason: 'length',
        })
      },
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(report.rejected).toEqual([
      {
        key: 'gen-retail-ceo-1',
        problems: ['No object generated: could not parse the response. (finishReason: length)'],
      },
    ])
  })

  test('rejects a plan that mentions an already existing persona', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth')],
      personas: [{ persona_key: 'someone', name: 'אושר' }],
    })
    // TEST_PLAN's requester is אושר, kept unchanged so the plan really carries it.
    const scripted = deps(undefined, {
      generatePlan: async (need) => ({
        ...TEST_PLAN,
        id: `gen-${need.industry}-${need.roleSlug}-${need.needKey}`,
      }),
    })
    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-growth', problems: ['התוכנית מזכירה בשמה את הדמות "אושר"'] },
    ])
  })

  test('a model error or a failed write rejects that item and the run continues', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth'), needRow('ceo', 1, 'people')],
      failKey: 'gen-retail-ceo-people',
    })
    const scripted = deps(undefined, {
      generatePersona: async (role, index) => {
        if (index === 2) throw new Error('rate limited')
        return {
          ...TEST_PERSONA,
          id: `gen-${role.industry}-${role.roleSlug}-${index}`,
          name: 'נועה',
        }
      },
    })

    const report = await generateLabContent(client, { force: false }, scripted.value)

    expect(report.written.sort()).toEqual(['gen-retail-ceo-1', 'gen-retail-ceo-growth'])
    expect(report.rejected).toEqual([
      { key: 'gen-retail-ceo-people', problems: ['שמירה נכשלה: disk full'] },
      { key: 'gen-retail-ceo-2', problems: ['rate limited'] },
    ])
  })

  test('checks both lab tables have source and generated_at before calling any model', async () => {
    const { client } = fakeClient({
      needs: [needRow('ceo', 1, 'growth')],
      failPreflightTable: 'persuasion_personas',
    })
    const { value, calls } = deps()

    await expect(generateLabContent(client, { force: false }, value)).rejects.toThrow(/source/)
    expect(calls.plans).toEqual([])
    expect(calls.personas).toEqual([])
  })

  test('refuses to run when there are no needs to generate from', async () => {
    const { client } = fakeClient({ needs: [] })
    await expect(generateLabContent(client, { force: false }, deps().value)).rejects.toThrow(
      'role_needs',
    )
  })
})
