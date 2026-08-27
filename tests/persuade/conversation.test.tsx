import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/persuade',
}))

const { Conversation } = await import('../../src/persuade/Conversation')

const ASSIGNMENT = {
  id: 'a1', ruleId: 'r1', assigneeId: 'p1', status: 'open' as const,
  dueOn: null, createdAt: '2026-08-25T09:00:00Z',
  rule: {
    id: 'r1', text: 'לקיים תדריך של 4 דקות בפתיחה, כל יום.',
    topicId: 'briefing', kind: 'process', subTopic: null, response: null,
  },
}

const persuaderApi = {
  openConversation: vi.fn(),
  reply: vi.fn(),
  finish: vi.fn(),
}

const setup = () => {
  render(
    <Conversation assignment={ASSIGNMENT} onClose={vi.fn()} persuaderApi={persuaderApi as never} />,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.clearAllMocks()
  persuaderApi.openConversation.mockResolvedValue({
    turns: [{ speaker: 'persuader', text: 'רותי, רוצה לבקש ממך דבר אחד.' }],
    state: { rung: 1, blocker: 'none', outcome: 'open' },
  })
  persuaderApi.reply.mockResolvedValue({
    turns: [
      { speaker: 'persuader', text: 'רותי, רוצה לבקש ממך דבר אחד.' },
      { speaker: 'target', text: 'אין לי זמן לזה בבוקר.' },
      { speaker: 'persuader', text: 'ארבע דקות ביום הן עשרים בשבוע.' },
    ],
    state: { rung: 2, blocker: 'overloaded', outcome: 'open' },
  })
})

describe('the conversation', () => {
  it('opens by asking the engine for the first move', async () => {
    setup()

    await waitFor(() => expect(persuaderApi.openConversation)
      .toHaveBeenCalledWith(expect.objectContaining({ assignmentId: 'a1' })))
    expect(await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')).toBeVisible()
  })

  it('says which rung it is on and what it detected', async () => {
    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.type(screen.getByLabelText('התשובה שלה'), 'אין לי זמן')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    // The blocker is what chose the next argument, so hiding it makes the reply
    // look arbitrary. One rung at a time, and the screen says which.
    expect(await screen.findByText(/overloaded/)).toBeVisible()
    expect(screen.getByText(/שלב 2/)).toBeVisible()
  })

  it('never settles the assignment when the conversation ends', async () => {
    persuaderApi.finish.mockResolvedValue({ outcome: 'agreed' })
    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.click(screen.getByRole('button', { name: 'סיום' }))

    // recordAsked runs on every finished conversation and settles nothing,
    // whatever the outcome. Only an execution report may settle -- agreement is
    // not execution.
    await waitFor(() => expect(persuaderApi.finish).toHaveBeenCalled())
    expect(await screen.findByText(/לא נסגרה/)).toBeVisible()
  })

  it('says the engine failed rather than looking like it is still thinking', async () => {
    persuaderApi.openConversation.mockRejectedValue(new Error('down'))
    setup()

    expect(await screen.findByRole('alert')).toHaveTextContent(/נסי שוב/)
  })
})
