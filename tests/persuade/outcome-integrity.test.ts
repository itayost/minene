/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const route = () => readFileSync(new URL('../../app/api/persuade/chat/route.ts', import.meta.url), 'utf8')

describe('what a conversation is allowed to claim about itself', () => {
  it('re-derives the outcome from the turns rather than trusting the body', () => {
    const source = route()

    // The body carries `state`, and on finish that state was written verbatim.
    // A caller could POST {finish: true, state: {outcome: 'agreed'}} and record
    // an agreement that never happened, attributed to the assignee -- in a
    // system whose entire purpose is measuring persuasion honestly.
    //
    // The turns are evidence; the outcome is a reading of them, and this side
    // does the reading.
    expect(source).toMatch(/detectOutcome\(/)

    const derived = source.indexOf('detectOutcome(')
    const recorded = source.indexOf('recordAsked(')
    expect(derived).toBeGreaterThan(-1)
    expect(derived).toBeLessThan(recorded)
  })
})
