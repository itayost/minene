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
  id: 'a1',
  ruleId: 'r1',
  assigneeId: 'p1',
  status: 'open' as const,
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
}

const persuaderApi = {
  openConversation: vi.fn(),
  reply: vi.fn(),
  finish: vi.fn(),
}

/**
 * The engine's real shapes, not invented ones.
 *
 * The first version of this file mocked `{ speaker, text }` turns and a
 * singular `blocker`, and every test passed while the real screen rendered
 * unstyled messages and no blocker at all -- because the mock and the component
 * shared a misunderstanding the route never agreed to. These helpers exist so
 * the mock cannot drift from `Turn` and `ConversationState` again.
 */
const turn = (role: 'persuader' | 'target', text: string, interaction = 1) => ({
  role,
  text,
  interaction,
})

const state = (over: Record<string, unknown> = {}) => ({
  interaction: 1,
  rung: 1,
  blockers: [],
  signals: {},
  fatigue: 0,
  outcome: 'open',
  askStated: true,
  identityStated: true,
  startTimeSet: false,
  followUpAnnounced: false,
  ...over,
})

const setup = () => {
  render(
    <Conversation assignment={ASSIGNMENT} onClose={vi.fn()} persuaderApi={persuaderApi as never} />,
  )
  return userEvent.setup()
}

beforeEach(() => {
  vi.clearAllMocks()
  persuaderApi.openConversation.mockResolvedValue({
    turns: [turn('persuader', 'רותי, רוצה לבקש ממך דבר אחד.')],
    state: state(),
  })
  persuaderApi.reply.mockResolvedValue({
    turns: [
      turn('persuader', 'רותי, רוצה לבקש ממך דבר אחד.'),
      turn('target', 'אין לי זמן לזה בבוקר.', 2),
      turn('persuader', 'ארבע דקות ביום הן עשרים בשבוע.', 2),
    ],
    state: state({ rung: 2, blockers: ['overloaded'], interaction: 2 }),
  })
})

describe('the conversation', () => {
  it('opens by asking the engine for the first move', async () => {
    setup()

    await waitFor(() =>
      expect(persuaderApi.openConversation).toHaveBeenCalledWith(
        expect.objectContaining({ assignmentId: 'a1' }),
        expect.anything(),
      ),
    )
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
    persuaderApi.finish.mockResolvedValue({
      turns: [turn('persuader', 'רותי, רוצה לבקש ממך דבר אחד.')],
      state: state({ outcome: 'agreed' }),
    })
    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.click(screen.getByRole('button', { name: 'סיום' }))

    // recordAsked runs on every finished conversation and settles nothing,
    // whatever the outcome. Only an execution report may settle -- agreement is
    // not execution.
    await waitFor(() => expect(persuaderApi.finish).toHaveBeenCalled())
    expect(await screen.findByText(/לא נסגרה/)).toBeVisible()
  })

  it('tells the two sides apart in the markup, not by colour alone', async () => {
    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.type(screen.getByLabelText('התשובה שלה'), 'אין לי זמן')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    // data-from is what the stylesheet keys the two sides off. It read
    // turn.speaker, which the engine has never had, so every message rendered
    // identically aligned and coloured -- the exact distinction the CSS comment
    // claims is structural.
    const said = await screen.findByText('אין לי זמן לזה בבוקר.')
    expect(said).toHaveAttribute('data-from', 'target')
    expect(screen.getByText('ארבע דקות ביום הן עשרים בשבוע.')).toHaveAttribute(
      'data-from',
      'persuader',
    )
  })

  it('says the engine failed rather than looking like it is still thinking', async () => {
    persuaderApi.openConversation.mockRejectedValue(new Error('down'))
    setup()

    expect(await screen.findByRole('alert')).toHaveTextContent(/נסי שוב/)
  })
})

/**
 * The field report this behaviour exists for: "זמן התגובה בלתי אפשרי... צריך
 * תשובות משני הצדדים קצרות ומידיות, כמו במציאות". Both sides, so both sides are
 * tested: the bot's message arrives as it is written, and hers does not wait for
 * a round trip at all.
 */
describe('while the answer is still being written', () => {
  /** A reply that reports progress before it resolves, the way the real one does. */
  const streaming =
    (chunks: string[], result: unknown) =>
    async (_body: unknown, watch?: { onPreparing?: () => void; onDelta?: (s: string) => void }) => {
      watch?.onPreparing?.()
      let soFar = ''
      for (const chunk of chunks) {
        soFar += chunk
        watch?.onDelta?.(soFar)
      }
      return result
    }

  it('shows the message growing instead of a spinner', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })

    persuaderApi.openConversation.mockImplementation(
      async (_body: unknown, watch?: { onDelta?: (s: string) => void }) => {
        watch?.onDelta?.('רותי, ')
        watch?.onDelta?.('רותי, רוצה לבקש')
        await held
        return { turns: [turn('persuader', 'רותי, רוצה לבקש ממך דבר אחד.')], state: state() }
      },
    )

    setup()

    // Mid-flight: the partial text is on screen, in the bubble it will keep.
    const growing = await screen.findByText('רותי, רוצה לבקש')
    expect(growing).toHaveAttribute('data-from', 'persuader')
    expect(growing).toHaveAttribute('data-writing', 'true')

    release?.()

    // And it is replaced by the graded turn, not left beside it. A draft that
    // survives the result would show the message twice.
    expect(await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')).toBeVisible()
    await waitFor(() => expect(screen.queryByText('רותי, רוצה לבקש')).toBeNull())
    expect(screen.queryByText('רותי, רוצה לבקש ממך דבר אחד.')).not.toHaveAttribute('data-writing')
  })

  it('says it is preparing on the first conversation about an assignment', async () => {
    // The plan is built once per assignment and cached, so this is the only
    // wait left that is worth naming -- and naming it is the difference between
    // a slow moment and a broken one.
    persuaderApi.openConversation.mockImplementation(
      async (_body: unknown, watch?: { onPreparing?: () => void }) => {
        watch?.onPreparing?.()
        await new Promise((resolve) => setTimeout(resolve, 20))
        return { turns: [turn('persuader', 'שלום')], state: state() }
      },
    )

    setup()

    expect(await screen.findByText('מכינה את השיחה…')).toBeVisible()
  })

  it('puts her own message up before the request comes back', async () => {
    persuaderApi.reply.mockImplementation(
      streaming(['ארבע דקות'], {
        turns: [
          turn('persuader', 'רותי, רוצה לבקש ממך דבר אחד.'),
          turn('target', 'אין לי זמן', 2),
          turn('persuader', 'ארבע דקות ביום הן עשרים בשבוע.', 2),
        ],
        state: state({ interaction: 2 }),
      }),
    )

    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.type(screen.getByLabelText('התשובה שלה'), 'אין לי זמן')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    // Hers, echoed locally. Before this it waited for the whole answer, so
    // pressing שליחה emptied the box and showed nothing for the entire wait.
    expect(await screen.findByText('אין לי זמן')).toHaveAttribute('data-from', 'target')
  })

  it('will not let her close the conversation mid-answer', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    persuaderApi.reply.mockImplementation(async () => {
      await held
      return { turns: [turn('persuader', 'ארבע דקות ביום.')], state: state() }
    })

    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.type(screen.getByLabelText('התשובה שלה'), 'אין לי זמן')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    // `turns` now carries her reply optimistically, so finishing here would post
    // a turn the engine has not graded and settle the record from it.
    expect(screen.getByRole('button', { name: 'סיום' })).toBeDisabled()

    release?.()
    await waitFor(() => expect(screen.getByRole('button', { name: 'סיום' })).toBeEnabled())
  })

  it('takes her message back down when the send fails', async () => {
    persuaderApi.reply.mockRejectedValue(new Error('down'))

    const user = setup()
    await screen.findByText('רותי, רוצה לבקש ממך דבר אחד.')
    await user.type(screen.getByLabelText('התשובה שלה'), 'אין לי זמן')
    await user.click(screen.getByRole('button', { name: 'שליחה' }))

    // An echo left on screen after a failed send reads as delivered, which is
    // the one thing an optimistic update must never do.
    expect(await screen.findByRole('alert')).toHaveTextContent(/נסי שוב/)
    // Scoped to the thread: the same words are legitimately back in the
    // composer below, which is the other half of this behaviour.
    expect(screen.queryByText('אין לי זמן', { selector: '.conversation__msg' })).toBeNull()
    // And the words are back in the box, so retrying is not retyping.
    expect(screen.getByLabelText('התשובה שלה')).toHaveValue('אין לי זמן')
  })
})
