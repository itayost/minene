import { describe, expect, it } from 'vitest'
import { config } from '../../middleware'

/**
 * The matcher is a negative lookahead listing what the middleware skips, so the
 * cheapest honest check is to run it the way Next does.
 */
const matches = (path: string) => new RegExp(`^${config.matcher[0]}$`).test(path)

describe('the middleware and the persuasion API', () => {
  it('does not redirect an API call to the login screen', () => {
    // The matcher exists to send a signed-out visitor to /login. Applied to a
    // route that answers a fetch, it turns a 401 into a 307 pointing at an HTML
    // page, which no caller can act on. The routes verify their own caller
    // before touching the model, so exclusion is the fix rather than a second
    // check that would duplicate one that already exists.
    expect(matches('/api/persuade/chat')).toBe(false)
    expect(matches('/api/persuade/simulate')).toBe(false)
  })

  it('still guards every page route', () => {
    // The exclusion is for /api only. A brand page with no session must still
    // be sent to sign in.
    expect(matches('/minene/tools/persuade')).toBe(true)
    expect(matches('/minene')).toBe(true)
  })

  it('still lets the login and logout routes through', () => {
    expect(matches('/login')).toBe(false)
    expect(matches('/logout')).toBe(false)
  })
})
