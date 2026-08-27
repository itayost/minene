import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeRule } from '../fixtures/rule'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/book',
}))
vi.mock('../../src/auth/supabase-browser', () => ({ createBrowserSupabase: () => ({}) }))

const rulesApi = vi.hoisted(() => ({
  listRules: vi.fn(),
  listProvenProcesses: vi.fn(),
  listMyVotes: vi.fn(),
  setRuleVote: vi.fn(),
  clearRuleVote: vi.fn(),
  submitInternalRule: vi.fn(),
}))
const rolesApi = vi.hoisted(() => ({ listRoles: vi.fn() }))

vi.mock('../../src/brain/rules-api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createRulesApi: () => rulesApi,
}))
vi.mock('../../src/brain/roles-api', () => ({ createRolesApi: () => rolesApi }))

const { BookClient } = await import('../../app/[brandId]/tools/brain/book/book-client')

const page = (rows: ReturnType<typeof makeRule>[]) => ({ rows, nextCursor: null })

beforeEach(() => {
  vi.clearAllMocks()
  rulesApi.listRules.mockResolvedValue(page([makeRule()]))
  rulesApi.listProvenProcesses.mockResolvedValue([])
  rulesApi.listMyVotes.mockResolvedValue(new Map())
  rulesApi.setRuleVote.mockResolvedValue({ ruleId: 'rule-1', isLike: true })
  rulesApi.clearRuleVote.mockResolvedValue(undefined)
  rolesApi.listRoles.mockResolvedValue([{ id: 'role-1', name: 'מנהלת חנות', sortOrder: 10 }])
})

const openTab = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('tab', { name }))
}

describe('the four ways the floor reads the knowledge base', () => {
  it('opens on every approved rule, filtered by nothing', async () => {
    render(<BookClient />)

    await waitFor(() => expect(rulesApi.listRules).toHaveBeenCalledWith({ topicId: null }))
  })

  it('asks for cases by kind rather than by scanning a general page', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'מקרים ותגובות')

    await waitFor(() => expect(rulesApi.listRules).toHaveBeenCalledWith({ topicId: null, kind: 'case' }))
  })

  it('asks for do and don’t as two calls, not one page filtered afterwards', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'עשה ואל תעשה')

    // A single unfiltered page would spend its fifty-row budget mostly on rules
    // with no polarity at all, which are the majority, and both lists would come
    // back short for a reason the reader cannot see.
    await waitFor(() => {
      expect(rulesApi.listRules).toHaveBeenCalledWith({ topicId: null, polarity: 'do', roleId: null })
      expect(rulesApi.listRules).toHaveBeenCalledWith({ topicId: null, polarity: 'dont', roleId: null })
    })
  })

  it('ranks proven processes through the call that orders by rating', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'תהליכים מוכחים')

    await waitFor(() => expect(rulesApi.listProvenProcesses).toHaveBeenCalled())
  })
})

describe('what the do and don’t lists show', () => {
  it('splits them under their own headings rather than mixing them with a badge', async () => {
    rulesApi.listRules.mockImplementation(async ({ polarity }: { polarity?: string }) => (
      polarity === 'do'
        ? page([makeRule({ id: 'do-1', text: 'לקבל לקוחה בכניסה', polarity: 'do' })])
        : page([makeRule({ id: 'dont-1', text: 'לא לעזוב את הקופה', polarity: 'dont' })])
    ))
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'עשה ואל תעשה')

    // "What to do" and "what never to do" are read as separate checklists.
    // Interleaving them makes a reader parse each row before knowing which it is.
    const doList = await screen.findByRole('list', { name: 'עשה' })
    const dontList = screen.getByRole('list', { name: 'אל תעשה' })
    expect(within(doList).getByText('לקבל לקוחה בכניסה')).toBeVisible()
    expect(within(dontList).getByText('לא לעזוב את הקופה')).toBeVisible()
  })

  it('narrows both lists to one job when a role is chosen', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'עשה ואל תעשה')
    await user.selectOptions(await screen.findByLabelText('תפקיד'), 'role-1')

    await waitFor(() => {
      expect(rulesApi.listRules).toHaveBeenCalledWith({ topicId: null, polarity: 'do', roleId: 'role-1' })
    })
  })

  it('still reads as every role when the role list fails to load', async () => {
    rolesApi.listRoles.mockRejectedValue(new Error('down'))
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'עשה ואל תעשה')

    // Every role is a superset, so nothing is hidden. Failing the whole page
    // over a filter that only one tab uses would hide the knowledge instead.
    await waitFor(() => expect(rulesApi.listRules).toHaveBeenCalledWith({ topicId: null, polarity: 'do', roleId: null }))
  })
})

describe('a rule as the floor sees it', () => {
  it('shows no score at all before anyone has voted', async () => {
    rulesApi.listRules.mockResolvedValue(page([makeRule({ like_pct: null, vote_count: 0 })]))
    render(<BookClient />)

    // The person reading it is the one being asked to rate it, so a "טרם דורג"
    // placeholder beside the buttons that would fix that is noise.
    await screen.findByText('לחייך')
    expect(screen.queryByText(/%/)).toBeNull()
  })

  it('carries the denominator alongside the percentage', async () => {
    render(<BookClient />)

    // 72% off four votes and 72% off forty are different claims.
    expect(await screen.findByLabelText('75 אחוז לייקים מתוך 4 מצביעים')).toBeVisible()
  })

  it('prints a case’s response, not only the situation it describes', async () => {
    rulesApi.listRules.mockResolvedValue(page([
      makeRule({ kind: 'case', text: 'לקוחה מבקשת החזר בלי חשבונית', response: 'להציע זיכוי' }),
    ]))
    render(<BookClient />)

    expect(await screen.findByText(/להציע זיכוי/)).toBeVisible()
  })

  it('links a hunted rule to the page it came from, without handing that page a way back', async () => {
    rulesApi.listRules.mockResolvedValue(page([
      makeRule({ source: 'external', source_url: 'https://example.com/retail' }),
    ]))
    render(<BookClient />)

    const link = await screen.findByRole('link', { name: 'מקור חיצוני' })
    expect(link).toHaveAttribute('href', 'https://example.com/retail')
    // The href is a URL a language model reported. rel is what keeps the opened
    // page from reaching back into this one.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})

describe('rating a rule', () => {
  it('echoes this person’s own vote back immediately', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await user.click(await screen.findByRole('button', { name: 'הוסיפי לייק' }))

    await waitFor(() => expect(rulesApi.setRuleVote).toHaveBeenCalledWith({ ruleId: 'rule-1', isLike: true }))
    expect(await screen.findByRole('button', { name: 'ביטול הלייק' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('never guesses the new percentage', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await user.click(await screen.findByRole('button', { name: 'הוסיפי לייק' }))
    await waitFor(() => expect(rulesApi.setRuleVote).toHaveBeenCalled())

    // The aggregate is recomputed by a trigger. Guessing at it here would show a
    // number that is subtly wrong until the next load.
    expect(screen.getByLabelText('75 אחוז לייקים מתוך 4 מצביעים')).toBeVisible()
  })

  it('withdraws a vote when the same side is pressed again', async () => {
    rulesApi.listMyVotes.mockResolvedValue(new Map([['rule-1', true]]))
    const user = userEvent.setup()
    render(<BookClient />)
    await user.click(await screen.findByRole('button', { name: 'ביטול הלייק' }))

    // Withdrawing is not switching sides: a cleared vote leaves the denominator,
    // a dislike stays in it.
    await waitFor(() => expect(rulesApi.clearRuleVote).toHaveBeenCalledWith({ ruleId: 'rule-1' }))
    expect(rulesApi.setRuleVote).not.toHaveBeenCalled()
  })

  it('says the rating did not save rather than leaving the row looking voted', async () => {
    rulesApi.setRuleVote.mockRejectedValue(new Error('down'))
    const user = userEvent.setup()
    render(<BookClient />)
    await user.click(await screen.findByRole('button', { name: 'הוסיפי לייק' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('הדירוג לא נשמר')
    expect(screen.getByRole('button', { name: 'הוסיפי לייק' })).toHaveAttribute('aria-pressed', 'false')
  })
})

describe('when there is nothing to show', () => {
  it('says why the proven list is empty, not that the business has no good processes', async () => {
    const user = userEvent.setup()
    render(<BookClient />)
    await openTab(user, 'תהליכים מוכחים')

    // Almost always the cause is that nobody has voted yet: a different problem
    // with a different fix, and one the reader can act on.
    expect(await screen.findByText(/דירוגים/)).toBeVisible()
  })
})
