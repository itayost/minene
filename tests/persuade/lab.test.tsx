import { render, screen, waitFor, within } from '@testing-library/react'
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
// A spy, not the real hook, so the stale-response test can assert directly on
// whether it was ever called rather than inferring that from text on a screen
// that no longer exists once the component has unmounted.
const handleError = vi.hoisted(() => vi.fn(() => 'לא הצלחנו להשלים את הבקשה'))
vi.mock('../../src/brain/use-api-error', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  useApiErrorHandler: () => handleError,
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

    // A real slug, not free text: the field is a select over the closed list
    // the database constrains `simulations.industry` to.
    await user.selectOptions(await screen.findByLabelText('ענף'), 'bank')
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(sims.listSimulationSummaries).toHaveBeenCalledTimes(2))
  })
})

describe('the grid is drawn from the taxonomy', () => {
  it('shows an industry nobody has run', async () => {
    // infrastructure has never had a run. It is on screen because the grid is
    // built from role_needs, and for an instrument the hole is the finding.
    // Scoped to the grid itself: both industry names are ALSO option labels in
    // RunControl's own industry select now, so a bare screen.findByText would
    // match twice.
    setup()

    const grid = await screen.findByRole('grid')
    expect(within(grid).getByText('תשתיות')).toBeInTheDocument()
    expect(within(grid).getByText('קמעונאות')).toBeInTheDocument()
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

  it('does not claim a need has no plan while the plan is still being read', async () => {
    // The whole screen's rule is that a measured fact beats an invented one,
    // and "אין עדיין תוכנית" is a claim about the library. While the read is in
    // flight nothing has been measured yet, so saying it would be inventing the
    // one fact this section exists to report.
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    let resolvePlan: (found: unknown) => void = () => {}
    labPlans.getPlan.mockReturnValue(
      new Promise((resolve) => {
        resolvePlan = resolve
      }),
    )
    setup()

    await waitFor(() => expect(labPlans.getPlan).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(/אין עדיין תוכנית/)).not.toBeInTheDocument()

    resolvePlan(null)
    expect(await screen.findByText(/אין עדיין תוכנית/)).toBeInTheDocument()
  })

  it('claims nothing about the need when the plan read fails outright', async () => {
    // A read that never answered is not evidence of an empty library. The alert
    // at the top says what actually happened; the section says nothing.
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    labPlans.getPlan.mockRejectedValue(new Error('boom'))
    setup()

    expect(await screen.findByText('לא הצלחנו לטעון את התוכנית')).toBeInTheDocument()
    expect(screen.queryByText(/אין עדיין תוכנית/)).not.toBeInTheDocument()
  })

  it('renders no persuasions section for a hand-edited URL naming only a need', async () => {
    // Only reachable by editing the URL directly -- the screen's own controls
    // never produce this. Without industry and role, `gen-<industry>-<role>-<need>`
    // cannot be built, so a plan lookup is not merely unnecessary here: it would
    // be a guess, and rendering "אין עדיין תוכנית" would assert something never
    // checked rather than something found to be true.
    search = new URLSearchParams('need=profitability')
    setup()

    await screen.findByRole('grid')
    expect(labPlans.getPlan).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('שכנועים לצורך')).not.toBeInTheDocument()
  })

  it('does not surface a plan-fetch failure that settles after the effect has cleaned up', async () => {
    // Cleanup runs identically on unmount and on a need change -- both set
    // `live = false` before an in-flight request can settle. Unmounting is the
    // reliable way to make that race happen in a test without depending on the
    // mocked router actually changing the URL, which it does not (see the top
    // of this file).
    search = new URLSearchParams('industry=retail&role=ceo&need=profitability')
    let rejectPlan: (error: unknown) => void = () => {}
    labPlans.getPlan.mockReturnValue(
      new Promise((_, reject) => {
        rejectPlan = reject
      }),
    )
    const { unmount } = render(<LabClient dailyCap={1000} personas={PERSONAS} plans={PLANS} />)
    await waitFor(() => expect(labPlans.getPlan).toHaveBeenCalledTimes(1))

    unmount()
    rejectPlan(new Error('boom'))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(handleError).not.toHaveBeenCalled()
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

describe('when the load itself fails', () => {
  it('says the load failed, in its own words, rather than claiming the map is empty', async () => {
    // Each of the three reads names itself when it throws (see taxonomy-api.ts
    // and lib/simulations.ts). Asserting on that exact text is how this test
    // tells "the load failed" from "the load succeeded and found nothing".
    taxonomy.listRoleNeeds.mockRejectedValue(new Error('קריאת מפת הצרכים נכשלה: bang'))
    setup()

    expect(await screen.findByText('קריאת מפת הצרכים נכשלה: bang')).toBeInTheDocument()
    // cells.length === 0 is true here too, exactly as it would be for a
    // genuinely empty taxonomy -- the claim below must not follow from that
    // alone.
    expect(screen.queryByText(/מפת הצרכים ריקה/)).not.toBeInTheDocument()
  })

  it('still makes the empty-map claim once a load actually succeeds and finds nothing', async () => {
    // The failure path must not swallow the success path: an empty
    // role_needs is still a real, reportable state once the read itself
    // worked.
    taxonomy.listRoleNeeds.mockResolvedValue([])
    setup()

    expect(await screen.findByText(/מפת הצרכים ריקה/)).toBeInTheDocument()
  })
})

describe('keeping the grid and the counters from drifting apart', () => {
  it('reloads the grid together with the counters when the operator presses refresh', async () => {
    const user = setup()
    await waitFor(() => expect(taxonomy.listRoleNeeds).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('button', { name: 'רענון' }))

    await waitFor(() => expect(taxonomy.listRoleNeeds).toHaveBeenCalledTimes(2))
    expect(sims.countSimulations).toHaveBeenCalledTimes(2)
  })

  it('reloads the grid when the poll finds a new total, and not merely because the timer ticked', async () => {
    vi.useFakeTimers()
    // Advancing the fake clock fires the interval and lets its own promise
    // chain settle, but the reload this test is watching for is one render
    // further downstream -- a state update in response to THAT chain, read by
    // an effect, that starts a second async call. A couple of zero-length
    // advances give React the extra microtask turns to catch up before the
    // next assertion.
    const settle = async () => {
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(0)
    }
    try {
      sims.countSimulations
        .mockResolvedValueOnce(168) // the read on mount
        .mockResolvedValueOnce(168) // first poll tick: unchanged
        .mockResolvedValueOnce(170) // second poll tick: a new run landed
      setup()
      await settle()

      expect(taxonomy.listRoleNeeds).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      await settle()
      // Same total as before: re-paging the grid off a bare timer tick is the
      // exact cost listSimulationSummaries exists to avoid.
      expect(taxonomy.listRoleNeeds).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(15_000)
      await settle()
      expect(taxonomy.listRoleNeeds).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
