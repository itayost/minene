import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RulesApiError } from '../../src/brain/rules-api'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/extract',
}))

const { ExternalHunt } = await import('../../src/brain/ExternalHunt')

function setup(huntExternal = vi.fn(async () => ({ rules: [{}, {}, {}] }))) {
  render(<ExternalHunt rulesApi={{ huntExternal }} />)
  return { huntExternal, user: userEvent.setup() }
}

const search = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'חיפוש ברשת' }))
}

describe('hunting the web for best practices', () => {
  it('searches the chosen topic', async () => {
    const { huntExternal, user } = setup()
    await user.selectOptions(screen.getByLabelText('נושא'), 'store')
    await search(user)

    expect(huntExternal).toHaveBeenCalledWith({ topicId: 'store', subTopic: null })
  })

  it('narrows the search when a sub-topic is named', async () => {
    const { huntExternal, user } = setup()
    await user.type(screen.getByLabelText(/תת־נושא/), '  אזור הקופה  ')
    await search(user)

    expect(huntExternal).toHaveBeenCalledWith({ topicId: 'live', subTopic: 'אזור הקופה' })
  })

  it('says how many recommendations are waiting, and where', async () => {
    const { user } = setup()
    await search(user)

    // Every finding lands pending with a link to where it came from. Saying
    // only "3 נמצאו" leaves the owner looking for them on this page.
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('3')
    expect(status).toHaveTextContent('לובי')
  })

  it('says why nothing was found rather than reporting a broken search', async () => {
    const { user } = setup(vi.fn(async () => ({ rules: [] })))
    await search(user)

    // Zero findings is a success with nothing to add: almost always everything
    // found was already inside the freshness window. A status, not an alert.
    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent('כבר קיים')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('reports a real failure as something to retry', async () => {
    const { user } = setup(vi.fn(async () => { throw new RulesApiError('REQUEST_FAILED', 502, 'nope') }))
    await search(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('נסי שוב')
  })

  it('sends an expired session to sign in instead of showing a message', async () => {
    const { user } = setup(vi.fn(async () => { throw new RulesApiError('UNAUTHORIZED', 401, 'פג') }))
    await search(user)

    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fminene%2Ftools%2Fbrain%2Fextract')
  })

  it('locks the form while the search is running', async () => {
    let release: (value: { rules: never[] }) => void = () => {}
    const pending = new Promise<{ rules: never[] }>((resolve) => { release = resolve })
    const { user } = setup(vi.fn(() => pending))
    await search(user)

    // A web search takes seconds. Without this the topic can be changed under a
    // request already in flight, and the result reads as the wrong topic's.
    expect(screen.getByLabelText('נושא')).toBeDisabled()
    expect(await screen.findByRole('status')).toHaveTextContent('מחפשת')
    release({ rules: [] })
  })
})
