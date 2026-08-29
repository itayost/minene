import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/persuade',
}))
vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const api = vi.hoisted(() => ({ listOpenAssignments: vi.fn(), settleAssignment: vi.fn() }))
vi.mock('../../src/persuade/assignments-api', async (o) => ({
  ...(await o<Record<string, unknown>>()),
  createAssignmentsApi: () => api,
}))

const { PersuadeClient } = await import('../../app/[brandId]/tools/persuade/persuade-client')

const assignment = (over = {}) => ({
  id: 'a1',
  ruleId: 'r1',
  assigneeId: 'p1',
  status: 'open',
  dueOn: null,
  createdAt: '2026-08-25T09:00:00Z',
  rule: {
    id: 'r1',
    text: 'לקיים תדריך של 4 דקות בפתיחה, כל יום.',
    topicId: 'briefing',
    kind: 'process',
    subTopic: null,
    response: null,
  },
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  api.listOpenAssignments.mockResolvedValue([assignment()])
})

describe('what has been asked of me', () => {
  it('lists the asks, not a menu of tools', async () => {
    render(<PersuadeClient brandId="minene" role="staff" />)

    expect(await screen.findByText('לקיים תדריך של 4 דקות בפתיחה, כל יום.')).toBeVisible()
  })

  it('renders an assignment whose rule failed to join', async () => {
    api.listOpenAssignments.mockResolvedValue([assignment({ rule: null })])
    render(<PersuadeClient brandId="minene" role="staff" />)

    // A task that vanishes from someone's list is worse than one that reads
    // awkwardly, so the row survives and says what it can.
    expect(await screen.findByText(/החוק לא נטען/)).toBeVisible()
  })

  it('says plainly when nothing is open', async () => {
    api.listOpenAssignments.mockResolvedValue([])
    render(<PersuadeClient brandId="minene" role="staff" />)

    expect(await screen.findByText(/אין כרגע משימות/)).toBeVisible()
  })

  it('gives an owner one link to the lab, and a staff member none', async () => {
    render(<PersuadeClient brandId="minene" role="owner" />)
    expect(await screen.findByRole('link', { name: /מעבדה/ })).toHaveAttribute(
      'href',
      '/minene/tools/persuade/lab',
    )

    cleanup()
    render(<PersuadeClient brandId="minene" role="staff" />)
    await screen.findByText('לקיים תדריך של 4 דקות בפתיחה, כל יום.')
    expect(screen.queryByRole('link', { name: /מעבדה/ })).toBeNull()
  })
})

describe('reporting what actually happened', () => {
  it('settles only through an execution report', async () => {
    api.settleAssignment.mockResolvedValue(assignment({ status: 'done' }))
    const user = userEvent.setup()
    render(<PersuadeClient brandId="minene" role="staff" />)

    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: /דיווח ביצוע/ }))
    await user.click(await screen.findByRole('button', { name: 'בוצע' }))

    await waitFor(() =>
      expect(api.settleAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ assignmentId: 'a1', status: 'done' }),
      ),
    )
  })

  it('records a partial as not done', async () => {
    api.settleAssignment.mockResolvedValue(assignment({ status: 'not_done' }))
    const user = userEvent.setup()
    render(<PersuadeClient brandId="minene" role="staff" />)

    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement
    await user.click(within(row).getByRole('button', { name: /דיווח ביצוע/ }))
    await user.click(await screen.findByRole('button', { name: /חלקית/ }))

    // Otherwise the measurement drifts upward one generous rounding at a time.
    await waitFor(() =>
      expect(api.settleAssignment).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'not_done' }),
      ),
    )
  })
})
