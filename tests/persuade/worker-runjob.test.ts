/**
 * @vitest-environment node
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { setModelOverrides } from '../../src/persuade/lib/model'
import { type JobRow, runJob } from '../../src/persuade/lib/worker'
import { jsonModel, scriptedAgreement, TEST_PERSONA, TEST_PLAN } from './helpers'

vi.mock('../../src/persuade/lib/content', () => ({
  getPersona: async () => TEST_PERSONA,
  getPlan: async () => TEST_PLAN,
}))

afterEach(() => setModelOverrides({}))

const SCORE = {
  persuaded: 'yes',
  winningArgument: null,
  winningCategory: null,
  mainObjection: null,
  whatBrokeIt: null,
  whatFailed: null,
  grade: 80,
  notes: 'בסדר',
  responseValidity: 'did',
}

const JOB: JobRow = {
  id: 'job-1',
  experiment: null,
  variant: null,
  persona_key: 'adi',
  plan_key: 'briefings',
  industry: 'retail',
  segment: null,
  job_role_id: null,
  need: null,
  rules: DEFAULT_RULES,
  world: null,
  attempts: 1,
  pass: 3,
}

describe('runJob', () => {
  test('writes usage and pass on the stored simulation', async () => {
    setModelOverrides({ ...scriptedAgreement(), judge: jsonModel([SCORE]) })

    // A plain `let` reassigned only inside the closure below stays narrowed
    // to its initial `null` across the `await runJob` call as far as the
    // compiler can tell, since it never sees the closure actually invoked --
    // an object wrapper sidesteps that.
    const state: { captured: Record<string, unknown> | null } = { captured: null }
    const client = {
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          state.captured = row
          return {
            select: () => ({
              single: async () => ({ data: { id: 'sim-1' }, error: null }),
            }),
          }
        },
      }),
    } as unknown as SupabaseClient

    const id = await runJob(client, JOB)
    const captured = state.captured
    if (!captured) throw new Error('insert was never called')

    expect(id).toBe('sim-1')
    expect(captured.usage).toEqual({
      persuader: { input: 10, output: 10 },
      target: { input: 10, output: 10 },
      judge: { input: 10, output: 10 },
      // A simulation never calls the planner; generation is what spends there.
      planner: { input: 0, output: 0 },
    })
    expect(captured.pass).toBe(3)
    expect(captured).toMatchObject({
      rules: DEFAULT_RULES,
      models: expect.any(Object),
      outcome: expect.any(String),
      world: null,
    })
  })

  // F7: `no_response` reaching a database whose check constraint predates
  // eran-task's migration looks, from `simulation_jobs.error`, exactly like
  // any other storage failure -- after the job already paid for up to eleven
  // model calls. The wrapped message has to name the missing migration.
  test('names the missing migration when the outcome check constraint rejects the insert', async () => {
    setModelOverrides({ ...scriptedAgreement(), judge: jsonModel([SCORE]) })

    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23514',
                message:
                  'new row for relation "simulations" violates check constraint "simulations_outcome_check" on column "outcome"',
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    await expect(runJob(client, JOB)).rejects.toThrow(/20260918120000_no_response_outcome/)
  })

  test('a check-constraint error unrelated to outcome is not mistaken for the missing migration', async () => {
    setModelOverrides({ ...scriptedAgreement(), judge: jsonModel([SCORE]) })

    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23514',
                message: 'violates check constraint "simulations_industry_check"',
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient

    await expect(runJob(client, JOB)).rejects.toThrow('שמירת הסימולציה נכשלה')
    await expect(runJob(client, JOB)).rejects.not.toThrow(/20260918120000_no_response_outcome/)
  })
})
