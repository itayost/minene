/**
 * @vitest-environment node
 *
 * Not jsdom, and it has to be a block comment -- vitest only reads this
 * pragma from one. This test reads a file, and under the jsdom environment
 * `import.meta.url` is not a file: URL, so readFileSync throws "The URL must be
 * of scheme file". A guard that throws looks exactly like a guard that fails,
 * which is the worst way for a guard to be broken.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * White is not a brand decision -- it is the absence of one, and it is already
 * how a raised surface sits on top of a sunken one. Everything else must come
 * from the brand, through a token.
 */
const ALLOWED = new Set([
  '#fff', '#ffffff',
  // A mask's stops are alpha, not paint: #000 there means "keep this pixel",
  // and no brand colour would be more correct.
  '#000',
])

const HEX = /#[0-9a-fA-F]{3,8}\b/g
/**
 * Hex is not the only way to write a colour, and the first draft of this guard
 * missed `box-shadow: 0 1px 3px rgb(29 38 69 / 12%)` -- the old navy, still
 * being painted, invisible to a hex-only check.
 *
 * A scrim and a tint genuinely need alpha, so the rule is not "no colour
 * functions": it is that a colour function must derive from a token rather than
 * from three numbers somebody picked.
 */
const FUNCTIONAL = /\b(?:rgba?|hsla?|oklch|lab|color|color-mix)\([^)]*\)/g

const brainCss = () => readFileSync(new URL('../../src/brain/brain.css', import.meta.url), 'utf8')

describe('the brain paints only in brand colours', () => {
  it('uses no hex outside the allowed set', () => {
    const offenders = [...new Set(brainCss().match(HEX) ?? [])]
      .filter((hex) => !ALLOWED.has(hex.toLowerCase()))

    // Eleven off-brand colours sat here for a week because a var() fallback
    // never fires inside the shell: the brain rendered cool blue-grey on a warm
    // cream shell and nothing failed. This is the check that notices.
    expect(offenders).toEqual([])
  })

  it('derives every alpha colour from a token rather than from three numbers', () => {
    const literals = (brainCss().match(FUNCTIONAL) ?? [])
      .filter((call) => !call.includes('var(--'))

    expect(literals).toEqual([])
  })

  it('leaves no var() fallback, which is a second palette hiding in plain sight', () => {
    // A fallback never fires inside the shell, so it is not a colour -- it is a
    // wrong value sitting where the next reader takes it for the real one.
    expect(brainCss().match(/var\(--[a-z-]+,\s*[^)]+\)/g) ?? []).toEqual([])
  })
})
