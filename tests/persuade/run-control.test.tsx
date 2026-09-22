import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/persuade/lab',
}))
vi.mock('../../src/auth/supabase-browser', () => ({
  createBrowserSupabase: vi.fn(() => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 't' } } }) },
  })),
}))

const { RunControl } = await import('../../src/persuade/RunControl')

const PERSONAS = [
  { id: 'rona', name: 'רונה', role: 'מנהלת חנות' },
  { id: 'adi', name: 'עדי', role: 'מוכרת' },
]
// Only id and topic are read for the label; the whole plan is what travels in
// the config, which is why the prop is the plan itself and not a summary of it.
const PLANS = [{ id: 'briefings', topic: 'תדריכי בוקר' }] as never
const ROLES = [{ id: 'r1', name: 'מנהלת חנות', sortOrder: 10 }]

const setup = (onFinished = vi.fn()) => {
  render(<RunControl onFinished={onFinished} personas={PERSONAS} plans={PLANS} roles={ROLES} />)
  return { user: userEvent.setup(), onFinished }
}

/**
 * Streams the given chunks verbatim, so a test can put a boundary anywhere --
 * including the middle of a JSON line, which is where the real route's chunks
 * land often enough to matter.
 *
 * `gate` holds the stream open before the chunk at that index, which is what
 * makes "shown while running" different from "shown when finished".
 */
const stream = (chunks: string[], gate?: { at: number; until: Promise<void> }) => ({
  ok: true,
  body: {
    getReader: () => {
      let i = 0
      return {
        read: async () => {
          if (gate && i === gate.at) await gate.until
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: new TextEncoder().encode(chunks[i++]) }
        },
      }
    },
  },
})

const lines = (...values: unknown[]) => values.map((v) => `${JSON.stringify(v)}\n`)

const ndjson = (values: unknown[]) => stream(lines(...values))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      ndjson([
        { type: 'turn', turn: { role: 'persuader', text: 'רותי, בקשה אחת.', interaction: 1 } },
        { type: 'turn', turn: { role: 'target', text: 'בסדר, ננסה.', interaction: 2 } },
        { type: 'done', run: { id: 'sim-1' } },
        { type: 'saved', id: 'sim-1' },
      ]),
    ),
  )
})

describe('starting a simulation', () => {
  it('defaults to a real industry already selected, since the field is a closed list now', async () => {
    // simulations.industry is a slug the database constrains to a closed list
    // (see cell.ts's INDUSTRY_LABELS). Free text used to let the field be left
    // blank; a select cannot be, so there is no longer a way to submit with no
    // industry chosen at all -- the run always carries a real one.
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.cell.industry).toBe('retail')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('sends the cell, the persona and the plan', async () => {
    const { user } = setup()
    await user.selectOptions(screen.getByLabelText('ענף'), 'bank')
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body).toMatchObject({
      personaId: 'rona',
      cell: { industry: 'bank', jobRoleId: 'r1' },
    })
    expect(body.config.plan.id).toBe('briefings')
  })

  it('shows the conversation as it arrives, not only when it ends', async () => {
    // The route streams a line per turn precisely so this can be watched. The
    // rest of the run is held back here, so anything that renders only on
    // `done` shows nothing at all rather than showing it a moment later.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        stream(
          lines(
            { type: 'turn', turn: { role: 'persuader', text: 'רותי, בקשה אחת.', interaction: 1 } },
            { type: 'turn', turn: { role: 'target', text: 'בסדר, ננסה.', interaction: 2 } },
            { type: 'done', run: { id: 'sim-1' } },
            { type: 'saved', id: 'sim-1' },
          ),
          { at: 2, until: held },
        ),
      ),
    )

    const { user, onFinished } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByText('רותי, בקשה אחת.')).toBeVisible()
    expect(await screen.findByText('בסדר, ננסה.')).toBeVisible()
    expect(onFinished).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
  })

  it('renders a silent turn as the no-reply marker, not an empty bubble', async () => {
    // F7: text is deliberately '' on a silent turn (see Turn.silent), so
    // rendering it plain looked identical to a still-loading message. The
    // marker is what the persuader itself was told for this turn.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ndjson([
          { type: 'turn', turn: { role: 'persuader', text: 'רותי, בקשה אחת.', interaction: 1 } },
          { type: 'turn', turn: { role: 'target', text: '', silent: true, interaction: 1 } },
          { type: 'done', run: { id: 'sim-1' } },
          { type: 'saved', id: 'sim-1' },
        ]),
      ),
    )

    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByText('[לא ענה]')).toBeVisible()
  })

  it('reassembles a line split across two chunks', async () => {
    const [turn, done, saved] = lines(
      { type: 'turn', turn: { role: 'persuader', text: 'רותי, בקשה אחת.', interaction: 1 } },
      { type: 'done', run: { id: 'sim-1' } },
      { type: 'saved', id: 'sim-1' },
    ) as [string, string, string]
    // Parsing whatever a chunk happens to contain throws here, and the run would
    // read as failed while the server had in fact finished it.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => stream([turn.slice(0, 20), turn.slice(20), done, saved])),
    )

    const { user, onFinished } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByText('רותי, בקשה אחת.')).toBeVisible()
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
  })

  it('reloads only once the run is actually stored, not when it merely ended', async () => {
    // The route scores and inserts after `done`. Reloading on `done` re-queries
    // before the row exists, and the matrix comes back without the run that was
    // just watched -- which reads as the run having been lost.
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        stream(lines({ type: 'done', run: { id: 'sim-1' } }, { type: 'saved', id: 'sim-1' }), {
          at: 1,
          until: held,
        }),
      ),
    )

    const { user, onFinished } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(onFinished).not.toHaveBeenCalled()

    release()
    await waitFor(() => expect(onFinished).toHaveBeenCalled())
  })

  it('says when the run was lost on the way to the database', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjson([{ type: 'done', run: { id: 'sim-1' } }, { type: 'unsaved' }])),
    )
    const { user, onFinished } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/לא נשמרה/)
    expect(onFinished).not.toHaveBeenCalled()
  })

  it('uses a role that only arrived after it mounted', async () => {
    // roles is loaded async by the screen above, so this always mounts with an
    // empty list. A default captured once leaves the state at '' while the
    // select shows a real role -- and the run is saved with no role at all,
    // which puts it in no column of the matrix, forever.
    const { rerender } = render(
      <RunControl onFinished={vi.fn()} personas={PERSONAS} plans={PLANS} roles={[]} />,
    )
    rerender(<RunControl onFinished={vi.fn()} personas={PERSONAS} plans={PLANS} roles={ROLES} />)

    const user = userEvent.setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body as string)
    expect(body.cell.jobRoleId).toBe('r1')
  })

  it('says when the run was saved without a score', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ndjson([{ type: 'unscored' }, { type: 'done', run: { id: 'sim-1' } }])),
    )
    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    // An unscored run is kept, but it cannot reach the bank -- so the cell will
    // show runs and no winning arguments, and that needs explaining here rather
    // than being discovered there.
    expect(await screen.findByText(/לא נוקדה/)).toBeVisible()
  })

  it('shows what the server actually said, not a generic failure', async () => {
    // The lab spent an afternoon reading "הרצת הסימולציה נכשלה" while the route
    // was returning a precise sentence naming the missing configuration. A
    // generic message here throws away the only thing that explains the failure.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          error: 'שכבת האחסון לא מוגדרת. צריך SUPABASE_URL ו-SUPABASE_SECRET_KEY בסביבה.',
        }),
      })),
    )
    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/SUPABASE_SECRET_KEY/)
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('falls back to its own words when the body carries none', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json')
        },
      })),
    )
    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/נכשלה/)
  })

  it('reports a refusal rather than looking like it is still running', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })),
    )
    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/נכשלה|בעלים/)
    // Not an expired session: signing in again changes nothing about not being
    // the owner, so this one stays on the page and says so.
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('sends the reader to sign in when the session has expired', async () => {
    // "ההרשאה פגה" as text leaves the reader on a screen whose every action now
    // fails, with nothing on it that fixes the problem. Every other surface here
    // routes a 401 through useApiErrorHandler, which navigates instead; this one
    // reported it as an error message and stranded them.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })),
    )
    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fminene%2Ftools%2Fpersuade%2Flab'),
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('treats a missing token the same as an expired one', async () => {
    // No session in the browser is the same predicament as a rejected one, and
    // it is the more common of the two: the tab was open across the expiry.
    const supabase = await import('../../src/auth/supabase-browser')
    vi.mocked(supabase.createBrowserSupabase).mockReturnValueOnce({
      auth: { getSession: async () => ({ data: { session: null } }) },
    } as never)
    const { user } = setup()
    // The industry field now defaults to a real, valid slug on mount (it is a
    // closed-list select), so these tests no longer need to touch it.
    await user.click(screen.getByRole('button', { name: 'הרצת סימולציה' }))

    await waitFor(() => expect(router.replace).toHaveBeenCalled())
    expect(fetch).not.toHaveBeenCalled()
  })
})
