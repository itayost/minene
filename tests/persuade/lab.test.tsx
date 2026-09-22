import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const router = { replace: vi.fn() }
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/persuade/lab',
  useSearchParams: () => search,
}))
vi.mock('../../src/auth/supabase-browser', () => ({
  createBrowserSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  }),
}))

const sims = vi.hoisted(() => ({
  listSimulations: vi.fn(),
  listSimulationSummaries: vi.fn(),
  countSimulations: vi.fn(),
  countSimulationsSince: vi.fn(),
  countAttemptsSince: vi.fn(),
}))
vi.mock('../../src/persuade/simulations-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createSimulationsApi: () => sims,
}))
const roles = vi.hoisted(() => ({ listRoles: vi.fn() }))
vi.mock('../../src/brain/roles-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createRolesApi: () => roles,
}))
const taxonomy = vi.hoisted(() => ({ listRoleNeeds: vi.fn() }))
vi.mock('../../src/persuade/taxonomy-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createTaxonomyApi: () => taxonomy,
}))
const labPlans = vi.hoisted(() => ({ getPlan: vi.fn() }))
vi.mock('../../src/persuade/lab-plans-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createLabPlansApi: () => labPlans,
}))

const { LabClient } = await import('../../app/[brandId]/tools/persuade/lab/lab-client')

const PERSONAS = [{ id: 'rona', name: 'רונה', role: 'מנהלת חנות' }]
const PLANS = [{ id: 'briefings', topic: 'תדריכי בוקר' }] as never

const NEEDS = [
  {
    industry: 'retail',
    roleSlug: 'ceo',
    roleLabel: 'מנכ"ל',
    roleOrder: 1,
    needKey: 'profitability',
    needLabel: 'רווחיות',
    needOrder: 1,
    metaNeed: 'money',
  },
  {
    industry: 'infrastructure',
    roleSlug: 'ceo',
    roleLabel: 'מנכ"ל',
    roleOrder: 1,
    needKey: 'uptime',
    needLabel: 'זמינות',
    needOrder: 1,
    metaNeed: 'control',
  },
]

const summary = (planId: string, outcome: string, score: unknown = null) =>
  ({
    id: `s-${planId}-${outcome}`,
    cell: { industry: 'retail', jobRoleId: null },
    run: { plan: { id: planId }, state: { outcome, blockers: [] }, score },
  }) as never

const setup = () => {
  render(<LabClient dailyCap={1000} personas={PERSONAS} plans={PLANS} />)
  return userEvent.setup()
}

beforeEach(() => {
  vi.clearAllMocks()
  search = new URLSearchParams()
  sims.listSimulations.mockResolvedValue([])
  sims.listSimulationSummaries.mockResolvedValue([])
  sims.countSimulations.mockResolvedValue(0)
  sims.countSimulationsSince.mockResolvedValue(0)
  sims.countAttemptsSince.mockResolvedValue(0)
  taxonomy.listRoleNeeds.mockResolvedValue(NEEDS)
  labPlans.getPlan.mockResolvedValue(null)
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
    // The grid is built from the taxonomy, not the runs, so it is not what
    // gates the control. RunControl sits outside the "cells.length === 0"
    // branch so that an empty taxonomy -- not merely an empty run history --
    // is the only thing that could ever hide it.
    setup()

    expect(await screen.findByRole('button', { name: 'הרצת סימולציה' })).toBeVisible()
  })

  it('reloads the matrix when a run lands, so the new cell appears', async () => {
    const user = setup()
    await waitFor(() => expect(sims.listSimulationSummaries).toHaveBeenCalledTimes(1))

    await user.type(await screen.findByLabelText('ענף'), 'אופנה')
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(sims.listSimulationSummaries).toHaveBeenCalledTimes(2))
  })
})

describe('the grid is drawn from the taxonomy', () => {
  it('shows an industry nobody has run', async () => {
    // infrastructure has never had a run. It is on screen because the grid is
    // built from role_needs, and for an instrument the hole is the finding.
    setup()

    expect(await screen.findByText('תשתיות')).toBeInTheDocument()
    expect(await screen.findByText('קמעונאות')).toBeInTheDocument()
  })

  it('says how many runs it could not place instead of dropping them', async () => {
    // Every run on record carries the briefings plan, which belongs to no cell.
    // Dropping them would show an empty grid beside a total of 168 with no hint
    // which number to believe.
    sims.listSimulationSummaries.mockResolvedValue([
      summary('briefings', 'agreed'),
      summary('briefings', 'refused'),
    ])
    setup()

    expect(await screen.findByText(/2 ריצות מחוץ למפה/)).toBeInTheDocument()
  })
})

describe('drilling down', () => {
  it('opens a role’s needs, with the meta-need beside each', async () => {
    const user = setup()
    await user.click(await screen.findByRole('gridcell', { name: /קמעונאות/ }))

    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining('industry=retail'),
      expect.anything(),
    )
    expect(router.replace).toHaveBeenCalledWith(
      expect.stringContaining('role=ceo'),
      expect.anything(),
    )
  })

  it('lists the needs of the selected role', async () => {
    search = new URLSearchParams('industry=retail&role=ceo')
    setup()

    expect(await screen.findByRole('button', { name: /רווחיות/ })).toBeInTheDocument()
    // The other industry's need must not leak into this role's list.
    expect(screen.queryByRole('button', { name: /זמינות/ })).not.toBeInTheDocument()
  })

  it('shows the arguments handed over, and states the attribution limit', async () => {
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    labPlans.getPlan.mockResolvedValue({
      id: 'gen-retail-ceo-profitability',
      arguments: [{ id: 'a1', category: 'numbers', text: 'המספרים מראים', strength: 8, why: '' }],
    })
    sims.listSimulationSummaries.mockResolvedValue([
      summary('gen-retail-ceo-profitability', 'agreed', {
        winningCategory: 'numbers',
        winningArgument: 'המספרים מראים',
        persuaded: 'yes',
      }),
    ])
    setup()

    expect(await screen.findByText('המספרים מראים')).toBeInTheDocument()
    // The caveat is on screen, not left to be assumed: winningArgument is free
    // text and the category is the only link back that is true.
    expect(await screen.findByText(/לפי קטגוריה/)).toBeInTheDocument()
  })

  it('says a need has no plan yet, which is not the same as having no runs', async () => {
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    labPlans.getPlan.mockResolvedValue(null)
    setup()

    expect(await screen.findByText(/אין עדיין תוכנית/)).toBeInTheDocument()
  })
})

describe('the counters', () => {
  it('shows the cumulative total and the cap', async () => {
    sims.countSimulations.mockResolvedValue(168)
    sims.countAttemptsSince.mockResolvedValue(12)
    setup()

    expect(await screen.findByText('168')).toBeInTheDocument()
    expect(await screen.findByText(/12 מתוך 1,000/)).toBeInTheDocument()
  })
})
