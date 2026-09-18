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

describe('the cell whose runs outlived their role', () => {
  it('reads the bank from every run the cell counted, not just the ones with no role id', async () => {
    // job_role_id is written against the catalogue as it stood when the run was
    // queued, and roles are hard-deleted -- so matrix-data.ts collects a run
    // whose role id no longer resolves into the UNASSIGNED column alongside the
    // runs that never had one. The panel under that column has to select the
    // same way. Selecting on `jobRoleId === null` alone puts two populations on
    // one screen: a headline saying 100% over one run, and a bank built from
    // zero that reports nothing here was ever scored.
    sims.listSimulations.mockResolvedValue([
      {
        id: 's1',
        cell: { industry: 'אופנה', jobRoleId: 'deleted-role' },
        run: {
          state: { outcome: 'agreed', blockers: ['overloaded'] },
          score: { winningCategory: 'social_proof', winningArgument: 'כולם כבר עושים את זה' },
          violations: [],
        },
      },
    ])
    const user = setup()

    await user.click(
      await screen.findByRole('gridcell', { name: 'אופנה, ללא תפקיד, 100 אחוז, 1 ריצות' }),
    )

    expect(await screen.findByText('ניצח 1×')).toBeVisible()
  })
})
