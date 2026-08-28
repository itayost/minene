/**
 * @vitest-environment node
 *
 * Reads the stylesheet, for the same reason tests/brain/palette.test.ts does:
 * jsdom has no layout engine, so the only honest check that a track is bounded
 * is that the declaration exists. The pragma must be a block comment -- vitest
 * reads it from no other kind.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8')

/**
 * The body of the rule that establishes the grid.
 *
 * Not simply the last rule with this selector: both selectors are also
 * re-declared inside media queries that override a property or two, and those
 * bodies say nothing about tracks.
 */
function gridRuleBody(selector: string): string {
  // Anchored at a line start and required to be followed by the brace, so
  // `.cockpit` cannot match `.cockpit-tools`.
  const bodies = [...css.matchAll(new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, 'gm'))]
    .map((m) => m[1] ?? '')
  const grid = bodies.find((body) => /display:\s*grid/.test(body))
  expect(grid, `no rule for ${selector} declares display: grid`).toBeDefined()
  return grid ?? ''
}

/**
 * Both of these stack full-width sections in a single column, and both had no
 * grid-template-columns at all.
 *
 * A grid with no declared track gets one `auto` column, and an `auto` track is
 * `minmax(min-content, max-content)` -- so it grows to the widest child's
 * max-content and then stretches EVERY sibling to that width. The mentor
 * composer's placeholder was the widest thing on the home screen, and it made
 * the tool cards 14px too wide for a 360px phone. `.cockpit` clips with
 * overflow-x: hidden, and in RTL the overflow runs leftward, so the left column
 * of cards was sliced off with nothing to scroll and no error anywhere.
 *
 * minmax(0, 1fr) is the fix and the rule: the track may not exceed its share of
 * the container, whatever a child would prefer.
 */
describe('the home screen stacks in a bounded column', () => {
  it.each(['\\.cockpit', '\\.mentor'])('%s bounds its single track', (selector) => {
    const body = gridRuleBody(selector).replace(/\s+/g, ' ')

    expect(body).toMatch(/grid-template-columns:\s*minmax\(\s*0\s*,/)
  })
})
