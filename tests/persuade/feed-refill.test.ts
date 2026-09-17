/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, test } from 'vitest'
import { worldCells } from '../../src/persuade/engine/world'
import { inputsVersion, pairInputs, refillFeed } from '../../src/persuade/lib/feed'

interface Row {
  [key: string]: unknown
}

interface FakeState {
  pending: number
  personas: Row[]
  plans: Row[]
  feed: { next_index: number; pass: number; inputs_version: string | null } | null
  commitResult: boolean
}

/** Answers exactly the reads refillFeed makes, and records the commit it sends. */
function fakeClient(state: FakeState) {
  const commits: Record<string, unknown>[] = []
  const client = {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              if (table === 'simulation_jobs')
                return Promise.resolve({ count: state.pending, error: null })
              if (table === 'persuasion_personas')
                return Promise.resolve({ data: state.personas, error: null })
              if (table === 'persuasion_lab_plans')
                return Promise.resolve({ data: state.plans, error: null })
              return { maybeSingle: async () => ({ data: state.feed, error: null }) }
            },
          }
        },
      }
    },
    async rpc(_fn: string, args: Record<string, unknown>) {
      commits.push(args)
      return { data: state.commitResult, error: null }
    },
  } as unknown as SupabaseClient
  return { client, commits }
}

const PERSONAS = [
  { persona_key: 'adi', industry: 'retail', job_role_name: 'מנהלת חנות', source: 'manual' },
  { persona_key: 'rona', industry: 'retail', job_role_name: 'מנהלת משמרת', source: 'manual' },
  { persona_key: 'bank-1', industry: 'bank', job_role_name: 'בנקאי', source: 'manual' },
]
const PLANS = [{ plan_key: 'briefings', industry: 'retail', job_role_name: null, source: 'manual' }]
const SETTINGS = { lowWater: 50, refillChunk: 5 }

const retailPairs = () =>
  pairInputs(
    [
      { key: 'adi', industry: 'retail', jobRoleName: 'מנהלת חנות', source: 'manual' },
      { key: 'rona', industry: 'retail', jobRoleName: 'מנהלת משמרת', source: 'manual' },
    ],
    [{ key: 'briefings', industry: 'retail', jobRoleName: null, source: 'manual' }],
  ).pairs

describe('refillFeed', () => {
  test('does nothing while the queue is above the low-water mark', async () => {
    const { client, commits } = fakeClient({
      pending: 50,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: true,
    })
    expect(await refillFeed(client, SETTINGS)).toEqual({ status: 'enough', pending: 50 })
    expect(commits).toHaveLength(0)
  })

  test('first refill plans from zero and reports personas with no plan', async () => {
    const { client, commits } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: true,
    })

    const report = await refillFeed(client, SETTINGS)

    expect(report).toEqual({
      status: 'queued',
      pending: 0,
      queued: 5,
      nextIndex: 5,
      pass: 0,
      unpairedPersonas: ['bank-1'],
    })
    const [commit] = commits
    expect(commit).toMatchObject({
      p_expected_index: 0,
      p_expected_pass: 0,
      p_expected_version: null,
      p_new_index: 5,
      p_new_pass: 0,
      p_new_version: inputsVersion(retailPairs(), worldCells().length),
    })
    const jobs = commit?.p_jobs as { persona_key: string; pass: number }[]
    expect(jobs).toHaveLength(5)
    expect(new Set(jobs.map((j) => j.persona_key))).toEqual(new Set(['adi', 'rona']))
    expect(jobs.every((j) => j.pass === 0)).toBe(true)
  })

  test('resumes from the stored index when the inputs have not changed', async () => {
    const version = inputsVersion(retailPairs(), worldCells().length)
    const { client, commits } = fakeClient({
      pending: 3,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 10, pass: 2, inputs_version: version },
      commitResult: true,
    })

    await refillFeed(client, SETTINGS)

    expect(commits[0]).toMatchObject({
      p_expected_index: 10,
      p_expected_pass: 2,
      p_expected_version: version,
      p_new_index: 15,
      p_new_pass: 2,
      p_new_version: version,
    })
  })

  test('restarts at zero when the inputs changed, but still expects the stored position', async () => {
    const { client, commits } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 99, pass: 3, inputs_version: 'old' },
      commitResult: true,
    })

    await refillFeed(client, SETTINGS)

    expect(commits[0]).toMatchObject({
      p_expected_index: 99,
      p_expected_pass: 3,
      p_expected_version: 'old',
      p_new_index: 5,
      p_new_pass: 0,
    })
  })

  test('reports a lost race when another tick committed first', async () => {
    const { client } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: false,
    })
    expect(await refillFeed(client, SETTINGS)).toEqual({ status: 'lost-race', pending: 0 })
  })

  test('reports no pairs instead of committing an empty chunk', async () => {
    const { client, commits } = fakeClient({
      pending: 0,
      personas: [PERSONAS[2] as Row],
      plans: PLANS,
      feed: { next_index: 0, pass: 0, inputs_version: null },
      commitResult: true,
    })
    expect(await refillFeed(client, SETTINGS)).toEqual({
      status: 'no-pairs',
      pending: 0,
      unpairedPersonas: ['bank-1'],
    })
    expect(commits).toHaveLength(0)
  })

  test('throws when the feed row is missing, which means the migration is not applied', async () => {
    const { client } = fakeClient({
      pending: 0,
      personas: PERSONAS,
      plans: PLANS,
      feed: null,
      commitResult: true,
    })
    await expect(refillFeed(client, SETTINGS)).rejects.toThrow('simulation_feed')
  })
})
