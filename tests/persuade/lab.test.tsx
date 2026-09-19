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

describe('a cell that spans a persuader-model swap', () => {
  it('warns that the rate may reflect the swap, not the industry or role', async () => {
    sims.listSimulations.mockResolvedValue([
      {
        id: 's1',
        cell: { industry: 'אופנה', jobRoleId: 'r1' },
        run: { state: { outcome: 'agreed' }, violations: [] },
        models: { persuader: 'gpt-4o-mini', target: 'gpt-4o-mini', judge: 'gpt-4o-mini' },
      },
      {
        id: 's2',
        cell: { industry: 'אופנה', jobRoleId: 'r1' },
        run: { state: { outcome: 'refused' }, violations: [] },
        models: { persuader: 'gpt-5', target: 'gpt-4o-mini', judge: 'gpt-4o-mini' },
      },
    ])
    const user = setup()

    await user.click(await screen.findByRole('gridcell', { name: /אופנה/ }))

    expect(await screen.findByText(/יותר ממודל שכנוע אחד/)).toBeVisible()
  })

  it('says nothing when a cell’s runs share one model', async () => {
    sims.listSimulations.mockResolvedValue([
      {
        id: 's1',
        cell: { industry: 'אופנה', jobRoleId: 'r1' },
        run: { state: { outcome: 'agreed' }, violations: [] },
        models: { persuader: 'gpt-4o-mini', target: 'gpt-4o-mini', judge: 'gpt-4o-mini' },
      },
    ])
    const user = setup()

    await user.click(await screen.findByRole('gridcell', { name: /אופנה/ }))

    expect(screen.queryByText(/יותר ממודל שכנוע אחד/)).not.toBeInTheDocument()
  })
})
