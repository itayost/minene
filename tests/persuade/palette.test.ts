/**
 * @vitest-environment node
 *
 * Reads a file, so not jsdom -- the same reason brain.css's guard runs here.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** White only. Everything else comes from the brand, through a token. */
const ALLOWED = new Set(['#fff', '#ffffff', '#000'])
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const FUNCTIONAL = /\b(?:rgba?|hsla?|oklch|lab|color|color-mix)\([^)]*\)/g

const css = () => readFileSync(new URL('../../src/persuade/persuade.css', import.meta.url), 'utf8')

describe('the persuasion surfaces paint only in brand colours', () => {
  it('uses no hex outside the allowed set', () => {
    const offenders = [...new Set(css().match(HEX) ?? [])].filter(
      (hex) => !ALLOWED.has(hex.toLowerCase()),
    )

    // The same guard brain.css has, and for the same reason: eleven off-brand
    // colours sat in that file for a week because a var() fallback never fires
    // inside the shell.
    expect(offenders).toEqual([])
  })

  it('derives every mixed colour from a token rather than from three numbers', () => {
    const literals = (css().match(FUNCTIONAL) ?? []).filter((call) => !call.includes('var(--'))

    // The heat ramp is five mixes. Each has to be a mix OF something the brand
    // owns, or the ramp quietly becomes a sixth palette.
    expect(literals).toEqual([])
  })

  it('leaves no var() fallback, which is a second palette hiding in plain sight', () => {
    expect(css().match(/var\(--[a-z-]+,\s*[^)]+\)/g) ?? []).toEqual([])
  })
})
