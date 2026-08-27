import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRule } from '../fixtures/rule'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/ingest',
}))
vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const documentsApi = vi.hoisted(() => ({
  uploadDocument: vi.fn(),
  saveConversation: vi.fn(),
  extractRules: vi.fn(),
  listRecentDocuments: vi.fn(),
}))
const rulesApi = vi.hoisted(() => ({
  huntExternal: vi.fn(),
  listPendingRules: vi.fn(),
  approveRule: vi.fn(),
  rejectRule: vi.fn(),
  updateRule: vi.fn(),
  loadKpis: vi.fn(),
}))
const rolesApi = vi.hoisted(() => ({ listRoles: vi.fn(), listRuleRoles: vi.fn(), setRuleRoles: vi.fn() }))

vi.mock('../../src/brain/documents-api', async (o) => ({
  ...(await o<Record<string, unknown>>()), createDocumentsApi: () => documentsApi,
}))
vi.mock('../../src/brain/rules-api', async (o) => ({
  ...(await o<Record<string, unknown>>()), createRulesApi: () => rulesApi,
}))
vi.mock('../../src/brain/roles-api', async (o) => ({
  ...(await o<Record<string, unknown>>()), createRolesApi: () => rolesApi,
}))

const { IngestClient } = await import('../../app/[brandId]/tools/brain/ingest/ingest-client')

const TENANT = '11111111-1111-4111-8111-111111111111'
const pdf = (name = 'נהלי פתיחה.pdf') => new File(['x'], name, { type: 'application/pdf' })

beforeEach(() => {
  vi.clearAllMocks()
  documentsApi.uploadDocument.mockResolvedValue({ documentId: 'doc-1', storagePath: 'p' })
  documentsApi.saveConversation.mockResolvedValue({ documentId: 'doc-2' })
  documentsApi.extractRules.mockResolvedValue({ rules: [{}, {}] })
  documentsApi.listRecentDocuments.mockResolvedValue({ rows: [], hasMore: false })
  rulesApi.huntExternal.mockResolvedValue({ rules: [] })
  rulesApi.listPendingRules.mockResolvedValue({ rows: [makeRule({ text: 'לחייך' })], nextCursor: null })
  rulesApi.loadKpis.mockResolvedValue({ knowledgeItems: 135, qualityItems: 6, growthPercent: 13 })
  // updateRule returns the saved rule, and the screen swaps it into the queue
  // inside a state updater -- which runs outside the try/catch around the save.
  // A mock resolving undefined therefore threw where nothing could catch it,
  // and the suite reported unhandled errors on every run.
  rulesApi.updateRule.mockResolvedValue(makeRule({ text: 'לחייך' }))
  rolesApi.listRoles.mockResolvedValue([])
  rolesApi.listRuleRoles.mockResolvedValue(new Map())
})

const setup = () => {
  render(<IngestClient tenantId={TENANT} />)
  return userEvent.setup()
}

describe('one screen for feeding the brain', () => {
  it('offers all three sources against a single topic picker', async () => {
    setup()
    await screen.findByRole('tab', { name: 'קובץ PDF' })

    // The hunt used to be its own section with its own duplicate topic select.
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(screen.getAllByLabelText('נושא')).toHaveLength(1)
  })

  it('shows what an upload produced without navigating anywhere', async () => {
    const user = setup()
    await user.upload(screen.getByLabelText(/קובץ PDF/), pdf())
    await user.click(screen.getByRole('button', { name: 'העלאה וחילוץ' }))

    // The reason these two screens merged: an owner used to be told "6 חוקים
    // ממתינים בלובי" and then had to go elsewhere to act on them.
    await waitFor(() => expect(rulesApi.listPendingRules).toHaveBeenCalledTimes(2))
  })

  it('gives the queue one filled action and two quiet ones', async () => {
    setup()
    const row = (await screen.findAllByRole('listitem'))[0] as HTMLElement

    // Thirty-two rows of three identical outlined buttons is why draining this
    // queue is tiring, and why discarding work looked like keeping it.
    expect(within(row).getByRole('button', { name: /אישור/ })).toHaveAttribute('data-weight', 'primary')
    expect(within(row).getByRole('button', { name: /דחייה/ })).toHaveAttribute('data-weight', 'quiet')
    expect(within(row).getByRole('button', { name: /עריכה/ })).toHaveAttribute('data-weight', 'quiet')
  })

  it('says how much the brain knows, on the screen you teach it from', async () => {
    setup()
    expect(await screen.findByText('135')).toBeVisible()
  })

  it('approves from the queue without leaving the form', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'אישור: לחייך' }))

    await waitFor(() => expect(rulesApi.approveRule).toHaveBeenCalledWith('rule-1'))
  })

  it('hunts the web as a third mode, not a section below', async () => {
    const user = setup()
    await user.click(screen.getByRole('tab', { name: 'חיפוש ברשת' }))
    await user.click(screen.getByRole('button', { name: 'חיפוש ברשת' }))

    await waitFor(() => expect(rulesApi.huntExternal)
      .toHaveBeenCalledWith(expect.objectContaining({ topicId: 'live' })))
  })
})

describe('choosing a file without the browser speaking English', () => {
  it('names the chosen file, in Hebrew', async () => {
    const user = setup()
    await user.upload(screen.getByLabelText(/קובץ PDF/), pdf('נהלי פתיחה.pdf'))

    // A bare <input type="file"> renders the browser's own control, which is
    // why this screen showed "Choose File / No file chosen" in English in the
    // middle of an RTL page.
    expect(await screen.findByText(/נהלי פתיחה\.pdf/)).toBeVisible()
  })

  it('says no file is chosen rather than showing nothing', () => {
    setup()
    expect(screen.getByText('לא נבחר קובץ')).toBeVisible()
  })

  it('does not run the action and the state together in its accessible name', () => {
    setup()

    // The two spans are separate visual lines, so nothing looked wrong -- but
    // textContent concatenated them into "בחרי קובץ PDFלא נבחר קובץ", and a
    // screen reader reads "PDFלא" as one token.
    const input = screen.getByLabelText(/קובץ PDF/) as HTMLInputElement
    expect(input.labels?.[0]?.textContent).toMatch(/PDF\s/)
  })

  it('keeps the input reachable by keyboard', () => {
    setup()

    // Hidden with clip-path, never display:none -- the latter takes it out of
    // the tab order, so the control becomes mouse-only.
    expect(screen.getByLabelText(/קובץ PDF/)).toBeInTheDocument()
  })
})

describe('when the role catalogue could not be loaded', () => {
  it('does not wipe a rule’s roles just because a reviewer fixed a typo', async () => {
    rolesApi.listRoles.mockRejectedValue(new Error('down'))
    rolesApi.listRuleRoles.mockRejectedValue(new Error('down'))
    const user = setup()

    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    // setRuleRoles REPLACES. With the catalogue missing the sheet hides the
    // fieldset and the draft carries an empty set, so saving an unrelated edit
    // would delete every rule_roles row for that rule, silently and for good.
    await waitFor(() => expect(rulesApi.updateRule).toHaveBeenCalled())
    expect(rolesApi.setRuleRoles).not.toHaveBeenCalled()
  })

  it('still writes the roles when the catalogue is there', async () => {
    rolesApi.listRoles.mockResolvedValue([{ id: 'role-1', name: 'מנהלת חנות', sortOrder: 10 }])
    const user = setup()

    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    await waitFor(() => expect(rolesApi.setRuleRoles).toHaveBeenCalled())
  })
})

describe('a pending rule filed under a topic nobody recognises', () => {
  it('does not silently re-file it when a reviewer edits the wording', async () => {
    rulesApi.listPendingRules.mockResolvedValue({
      rows: [makeRule({ text: 'לחייך', topic_id: 'retired-topic' })],
      nextCursor: null,
    })
    const user = setup()

    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))
    await user.click(screen.getByRole('button', { name: 'שמירה' }))

    // updateRule always sends topic_id. Coercing an unknown topic to the first
    // one in the catalogue meant a reviewer who only fixed a typo rewrote the
    // rule's subject without ever seeing the change.
    await waitFor(() => expect(rulesApi.updateRule)
      .toHaveBeenCalledWith(expect.objectContaining({ topicId: 'retired-topic' })))
  })

  it('offers the unknown topic in the picker, so the reviewer can see it', async () => {
    rulesApi.listPendingRules.mockResolvedValue({
      rows: [makeRule({ text: 'לחייך', topic_id: 'retired-topic' })],
      nextCursor: null,
    })
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'עריכה: לחייך' }))

    expect(screen.getByLabelText('נושא', { selector: '#rule-edit-topic' })).toHaveValue('retired-topic')
  })
})

describe('a queue that could be very long', () => {
  it('stops paging rather than issuing an unbounded run of requests', async () => {
    rulesApi.listPendingRules.mockImplementation(async () => ({
      rows: Array.from({ length: 50 }, (_, i) => makeRule({ id: `r${i}`, text: `חוק ${i}` })),
      nextCursor: { created_at: 'T', id: 'x' },
    }))
    setup()

    // It runs on mount and again after every upload, hunt and extraction. A
    // tenant with 600 pending rules issued 13 sequential RPCs each time, and
    // then fed every id into one in(...) filter, whose URL a proxy will refuse
    // long before that -- landing straight in the role-wipe path above.
    await waitFor(() => expect(rulesApi.listPendingRules).toHaveBeenCalled())
    await waitFor(() => expect(rulesApi.listPendingRules.mock.calls.length).toBeLessThanOrEqual(4))
  })
})
