import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { RulesApiError } from '../../src/brain/rules-api'
import { makeRule } from '../fixtures/rule'

const router = { replace: vi.fn() }
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => '/minene/tools/brain/book',
}))

const { SubmitKnowledge } = await import('../../src/brain/SubmitKnowledge')

function setup(submitInternalRule = vi.fn(async () => makeRule())) {
  const onSubmitted = vi.fn()
  render(<SubmitKnowledge onSubmitted={onSubmitted} rulesApi={{ submitInternalRule }} />)
  return { submitInternalRule, onSubmitted, user: userEvent.setup() }
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'הוספת ידע' }))
}

describe('contributing knowledge from the floor', () => {
  it('stays collapsed until someone means to use it', async () => {
    setup()

    // It sits above a list people came here to read. A permanently open
    // six-field form pushes that list off the first screen for the large
    // majority of visits, which are not submissions.
    expect(screen.getByRole('button', { name: 'הוספת ידע' })).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'החוק' })).toBeNull()
  })

  it('refuses an empty rule in front of the form rather than after a round trip', async () => {
    const { submitInternalRule, user } = setup()
    await open(user)
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    expect(screen.getByRole('alert')).toHaveTextContent('נא לכתוב את החוק.')
    expect(submitInternalRule).not.toHaveBeenCalled()
  })

  it('names the missing field when a case has no response', async () => {
    const { submitInternalRule, user } = setup()
    await open(user)
    await user.selectOptions(screen.getByLabelText('סוג'), 'case')
    await user.type(screen.getByLabelText('המקרה'), 'לקוחה מבקשת החזר בלי חשבונית')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    // rules_response_matches_kind rejects this at the database level too. The
    // check here is what turns a constraint name nobody can act on into a
    // sentence that says which field is missing.
    expect(screen.getByRole('alert')).toHaveTextContent('תגובה')
    expect(submitInternalRule).not.toHaveBeenCalled()
  })

  it('sends a case with its response, and every other axis it was given', async () => {
    const { submitInternalRule, user } = setup()
    await open(user)
    await user.selectOptions(screen.getByLabelText('סוג'), 'case')
    await user.type(screen.getByLabelText('תת־נושא'), '  החזרות  ')
    await user.type(screen.getByLabelText('המקרה'), 'לקוחה מבקשת החזר בלי חשבונית')
    await user.type(screen.getByLabelText('התגובה'), 'להציע זיכוי')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    expect(submitInternalRule).toHaveBeenCalledWith({
      topicId: 'live',
      text: 'לקוחה מבקשת החזר בלי חשבונית',
      kind: 'case',
      subTopic: 'החזרות',
      polarity: null,
      response: 'להציע זיכוי',
    })
  })

  it('never sends a response on a kind that is not a case', async () => {
    const { submitInternalRule, user } = setup()
    await open(user)
    await user.selectOptions(screen.getByLabelText('סוג'), 'case')
    await user.type(screen.getByLabelText('התגובה'), 'להציע זיכוי')
    await user.selectOptions(screen.getByLabelText('סוג'), 'tip')
    await user.type(screen.getByLabelText('החוק'), 'לחייך')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    // The same constraint refuses it from the other direction, so a response
    // left behind by a change of mind would fail the whole submission.
    expect(submitInternalRule).toHaveBeenCalledWith(expect.objectContaining({ kind: 'tip', response: null }))
  })

  it('sends an untouched sub-topic as null rather than as an empty string', async () => {
    const { submitInternalRule, user } = setup()
    await open(user)
    await user.type(screen.getByLabelText('החוק'), 'לחייך')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    expect(submitInternalRule).toHaveBeenCalledWith(expect.objectContaining({ subTopic: null, polarity: null }))
  })

  it('says what happens next, not merely that it worked', async () => {
    const { user } = setup()
    await open(user)
    await user.type(screen.getByLabelText('החוק'), 'לחייך')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    // A submission that vanishes into a review queue with no explanation reads
    // as a bug the first time someone checks the list and cannot find it.
    expect(await screen.findByRole('status')).toHaveTextContent('אחרי שהמנהל יאשר')
  })

  it('clears the form and tells the page to reload after a submission', async () => {
    const { onSubmitted, user } = setup()
    await open(user)
    await user.type(screen.getByLabelText('החוק'), 'לחייך')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    expect(onSubmitted).toHaveBeenCalled()
    expect(screen.getByLabelText('החוק')).toHaveValue('')
  })

  it('keeps what was typed when the submission fails', async () => {
    const { user } = setup(vi.fn(async () => { throw new RulesApiError('REQUEST_FAILED', 500, 'nope') }))
    await open(user)
    await user.type(screen.getByLabelText('החוק'), 'לחייך')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    // Retyping a paragraph because a request failed is how someone stops
    // contributing at all.
    expect(await screen.findByRole('alert')).toHaveTextContent('נסי שוב')
    expect(screen.getByLabelText('החוק')).toHaveValue('לחייך')
  })

  it('sends an expired session to sign in instead of showing a message', async () => {
    const { user } = setup(vi.fn(async () => { throw new RulesApiError('UNAUTHORIZED', 401, 'פג') }))
    await open(user)
    await user.type(screen.getByLabelText('החוק'), 'לחייך')
    await user.click(screen.getByRole('button', { name: 'שליחה לאישור' }))

    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fminene%2Ftools%2Fbrain%2Fbook')
  })
})
