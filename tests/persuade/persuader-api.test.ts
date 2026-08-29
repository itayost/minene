import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getSession = vi.fn()
vi.mock('../../src/auth/supabase-browser', () => ({
  createBrowserSupabase: () => ({ auth: { getSession } }),
}))

const { createPersuaderApi } = await import('../../src/persuade/persuader-api')

/**
 * The client half of the NDJSON contract.
 *
 * Its whole job is turning a byte stream into one result plus a running string,
 * and every interesting case is a chunk boundary: the network does not respect
 * newlines, so a naive reader parses half an object and throws exactly when the
 * message is long enough to matter.
 */

/** A response whose body arrives in the given pieces, newlines wherever they fall. */
const streamed = (pieces: string[], status = 200) => {
  const encoder = new TextEncoder()
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const piece of pieces) controller.enqueue(encoder.encode(piece))
        controller.close()
      },
    }),
  } as Response
}

const line = (event: unknown) => `${JSON.stringify(event)}\n`

const RESULT = {
  type: 'result',
  turns: [{ role: 'persuader', text: 'שלום רותי', interaction: 0 }],
  state: { rung: 1, blockers: [] },
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: { access_token: 'token' } } })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('reading the engine stream', () => {
  it('reports the message so far, not the fragment', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamed([
          line({ type: 'delta', text: 'רותי, ' }),
          line({ type: 'delta', text: 'רוצה לבקש ' }),
          line({ type: 'delta', text: 'דבר אחד.' }),
          line(RESULT),
        ]),
      ),
    )

    const seen: string[] = []
    await createPersuaderApi().openConversation(
      { assignmentId: 'a1' },
      { onDelta: (s) => seen.push(s) },
    )

    // Cumulative, because a component that appends fragments has to hold a
    // buffer and clear it at exactly the right moment -- and the right moment is
    // what gets missed when the next turn starts.
    expect(seen).toEqual(['רותי, ', 'רותי, רוצה לבקש ', 'רותי, רוצה לבקש דבר אחד.'])
  })

  it('survives a chunk that lands mid-object', async () => {
    const whole = line({ type: 'delta', text: 'ארבע דקות' }) + line(RESULT)
    const cut = Math.floor(whole.length / 3)

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamed([whole.slice(0, cut), whole.slice(cut, cut * 2), whole.slice(cut * 2)]),
      ),
    )

    const result = await createPersuaderApi().openConversation({ assignmentId: 'a1' })

    // The reader holds back everything after the last newline. Parsing it
    // eagerly is a crash on a boundary the network chooses, not a rare one.
    expect(result.turns).toHaveLength(1)
  })

  it('throws on an error event instead of returning a half conversation', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        streamed([
          line({ type: 'delta', text: 'מת' }),
          line({ type: 'error', message: 'לא הצלחנו לבנות תוכנית לשיחה הזאת.' }),
        ]),
      ),
    )

    // An error that arrives mid-stream is still an error. Returned as a field,
    // some caller eventually forgets to check it and posts the half state back.
    await expect(createPersuaderApi().openConversation({ assignmentId: 'a1' })).rejects.toThrow(
      'לא הצלחנו לבנות תוכנית לשיחה הזאת.',
    )
  })

  it('fails when the stream ends without a result', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamed([line({ type: 'delta', text: 'חצי' })])),
    )

    // A dropped connection is not a conversation anyone can continue from, and
    // returning what arrived would send a truncated turn list back on the next
    // message.
    await expect(createPersuaderApi().openConversation({ assignmentId: 'a1' })).rejects.toThrow()
  })

  it('still turns a 401 into a sign-in, before it reads a byte', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => streamed([], 401)),
    )

    await expect(
      createPersuaderApi().openConversation({ assignmentId: 'a1' }),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('sends the assignment and never a plan', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      void init
      return streamed([line(RESULT)])
    })
    vi.stubGlobal('fetch', fetchMock)

    await createPersuaderApi().reply({ assignmentId: 'a1', turns: [], reply: 'אין לי זמן' })

    // The route derives the plan from the assignment's own ammunition. A plan
    // travelling from here would be the client choosing which arguments the bot
    // is allowed to make.
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toEqual({ assignmentId: 'a1', turns: [], reply: 'אין לי זמן' })
  })
})
