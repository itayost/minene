import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/persuade/lab',
}))
vi.mock('../../src/auth/supabase-browser', () => ({
  createBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  }),
}))

const sims = vi.hoisted(() => ({ listSimulations: vi.fn() }))
vi.mock('../../src/persuade/simulations-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createSimulationsApi: () => sims,
}))
const roles = vi.hoisted(() => ({ listRoles: vi.fn() }))
vi.mock('../../src/brain/roles-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createRolesApi: () => roles,
}))

const { LabClient } = await import('../../app/[brandId]/tools/persuade/lab/lab-client')

const PERSONAS = [{ id: 'rona', name: 'רונה', role: 'מנהלת חנות' }]
const PLANS = [{ id: 'briefings', topic: 'תדריכי בוקר' }] as never

const setup = () => {
  render(<LabClient personas={PERSONAS} plans={PLANS} />)
  return userEvent.setup()
}

beforeEach(() => {
  vi.clearAllMocks()
  sims.listSimulations.mockResolvedValue([])
  roles.listRoles.mockResolvedValue([{ id: 'r1', name: 'מנהלת חנות', sortOrder: 10 }])
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      body: {
        getReader: () => {
          const chunks = [
            `${JSON.stringify({ type: 'done', run: { id: 's1' } })}\n`,
            `${JSON.stringify({ type: 'saved', id: 's1' })}\n`,
          ]
          let i = 0
          return {
            read: async () =>
              i < chunks.length
                ? { done: false, value: new TextEncoder().encode(chunks[i++]) }
                : { done: true, value: undefined },
          }
        },
      },
    })),
  )
})

describe('the lab, before anything has been run', () => {
  it('can still start the first run', async () => {
    // The matrix is built from runs, so it is empty until one exists. Putting
    // the control inside the "there are runs" branch would make the first run
    // the one thing this screen could never do.
    setup()

    expect(await screen.findByRole('button', { name: 'הרצת סימולציה' })).toBeVisible()
  })

  it('reloads the matrix when a run lands, so the new cell appears', async () => {
    const user = setup()
    await waitFor(() => expect(sims.listSimulations).toHaveBeenCalledTimes(1))

    await user.type(await screen.findByLabelText('ענף'), 'אופנה')
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(sims.listSimulations).toHaveBeenCalledTimes(2))
  })
})

describe('a cell with both ordinary and experiment-arm runs', () => {
  it('reports the headline and the bank from the ordinary runs alone', async () => {
    // queueExperiment (lib/experiments.ts) runs an arm under a RuleConfig
    // deliberately different from the deployed default and writes it to the
    // same industry/job_role_id as an ordinary sweep run. Nothing before this
    // fix told the two apart, so the headline rate and the bank beneath it
    // silently blended a conversation that ran under (say) a 25-word cap into
    // a number that claims to describe the deployed default.
    sims.listSimulations.mockResolvedValue([
      {
        id: 'ordinary',
        cell: { industry: 'אופנה', jobRoleId: 'r1' },
        experiment: null,
        run: {
          state: { outcome: 'agreed', blockers: ['overloaded'], interaction: 2 },
          violations: [],
          score: { winningCategory: 'numbers', winningArgument: 'פי שלוש', grade: 80 },
        },
      },
      {
        id: 'experiment-arm',
        cell: { industry: 'אופנה', jobRoleId: 'r1' },
        experiment: 'message-length',
        run: {
          state: { outcome: 'agreed', blockers: ['no_time'], interaction: 2 },
          violations: [],
          score: { winningCategory: 'social_proof', winningArgument: 'כולם עושים ככה', grade: 80 },
        },
      },
    ] as never)

    setup()

    const cell = await screen.findByRole('gridcell', {
      name: 'אופנה, מנהלת חנות, 100 אחוז, 1 ריצות',
    })
    await userEvent.click(cell)

    // The headline: one run, not two, and 100% agreed -- not 100% pooled with
    // the experiment arm's refusal into some other number.
    expect(await screen.findByText('1 ריצות · 100% שכנוע')).toBeVisible()

    // The bank: the ordinary run's winning argument, never the experiment
    // arm's -- a run against a different RuleConfig is not evidence about what
    // wins under the deployed default.
    expect(await screen.findByText('פי שלוש')).toBeVisible()
    expect(screen.queryByText('כולם עושים ככה')).not.toBeInTheDocument()
  })
})
