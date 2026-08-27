import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRule } from '../fixtures/rule'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/admin',
}))
vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const rulesApi = vi.hoisted(() => ({ listRules: vi.fn(), loadKpis: vi.fn(), setStar: vi.fn() }))
const rolesApi = vi.hoisted(() => ({ listRoles: vi.fn() }))
const peopleApi = vi.hoisted(() => ({ listPeople: vi.fn(), updatePerson: vi.fn() }))

vi.mock('../../src/brain/rules-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRulesApi: () => rulesApi,
}))
vi.mock('../../src/brain/roles-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRolesApi: () => rolesApi,
}))
vi.mock('../../src/brain/people-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createPeopleApi: () => peopleApi,
}))

const { AdminClient } = await import('../../app/[brandId]/tools/brain/admin/admin-client')

const show = (overrides = {}) => {
  rulesApi.listRules.mockResolvedValue({ rows: [makeRule(overrides)], nextCursor: null })
  render(<AdminClient />)
}

beforeEach(() => {
  vi.clearAllMocks()
  rulesApi.listRules.mockResolvedValue({ rows: [], nextCursor: null })
  rulesApi.loadKpis.mockResolvedValue({ knowledgeItems: 0, qualityItems: 0, growthPercent: null })
  rolesApi.listRoles.mockResolvedValue([])
  peopleApi.listPeople.mockResolvedValue([])
})

describe('what the history row now carries', () => {
  it('leads with the rule’s own per-tenant number', async () => {
    show({ rule_number: 12 })

    const row = await screen.findByRole('listitem')
    expect(within(row).getByText('#12')).toBeVisible()
  })

  it('shows the sub-topic it was filed under', async () => {
    show({ sub_topic: 'קבלת פנים' })

    expect(await screen.findByText('קבלת פנים')).toBeVisible()
  })

  it('marks an unfiled rule rather than leaving a blank', async () => {
    show({ sub_topic: null })

    // Unclassified is the normal state for every rule that predates the column,
    // and a blank reads as a rendering bug rather than as "not yet filed".
    expect(await screen.findByText('—')).toBeVisible()
  })

  it('badges a prohibition as one', async () => {
    show({ polarity: 'dont' })

    expect(await screen.findByText('אל תעשה')).toBeVisible()
  })

  it('carries the denominator beside the percentage', async () => {
    show({ like_pct: 80, vote_count: 5, like_count: 4 })

    // 80% off five votes and 80% off fifty support very different decisions, and
    // the whole point of measuring this was to stop guessing.
    expect(await screen.findByLabelText('80 אחוז לייקים מתוך 5 מצביעים')).toBeVisible()
  })

  it('says an unrated rule is unrated, never that it scored zero', async () => {
    show({ like_pct: null, vote_count: 0, like_count: 0 })

    // 0% would claim every reader disliked it, which is the opposite of what no
    // data means.
    expect(await screen.findByText('טרם דורג')).toBeVisible()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('prints a case’s response under the situation', async () => {
    show({ kind: 'case', text: 'לקוחה מבקשת החזר בלי חשבונית', response: 'להציע זיכוי' })

    expect(await screen.findByText(/להציע זיכוי/)).toBeVisible()
  })

  it('never reads an unclassified rule as a case', async () => {
    show({ kind: null as never, response: 'להציע זיכוי' })

    // A case is the only kind carrying a response, so an unclassified row
    // mistaken for one would render an answer under a situation that has none.
    // The historical default is a tip, and that is what a missing kind reads as.
    const row = await screen.findByRole('listitem')
    expect(within(row).getByText(/טיפ/)).toBeVisible()
    expect(within(row).queryByText(/להציע זיכוי/)).toBeNull()
  })
})

describe('filtering the history', () => {
  it('offers cases as a kind to filter by', async () => {
    render(<AdminClient />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'חיפוש וסינון' }))
    await user.selectOptions(screen.getByLabelText('סוג'), 'case')

    await vi.waitFor(() => expect(rulesApi.listRules).toHaveBeenCalledWith(expect.objectContaining({ kind: 'case' })))
  })
})

describe('the settings that sit beside the history', () => {
  it('offers the role catalogue and the people list on the same screen', async () => {
    render(<AdminClient />)

    // The role list is what the do/don't axis is filtered by, and the people
    // list is what makes that filter personal. Both are edited rarely and both
    // belong to the owner, which is who this screen is already gated to.
    expect(await screen.findByText('ניהול תפקידים')).toBeVisible()
    expect(screen.getByText('ניהול אנשים')).toBeVisible()
  })
})
