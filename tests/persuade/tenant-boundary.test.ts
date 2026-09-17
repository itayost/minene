/**
 * @vitest-environment node
 *
 * Reads files, so not jsdom -- import.meta.url is not a file: URL there and
 * readFileSync throws, which looks exactly like a failing guard rather than a
 * broken one.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

describe('a simulation never touches a tenant’s knowledge', () => {
  it('does not reach for ammunition, a tenant or an assignment', () => {
    const sim = source('src/persuade/engine/simulation.ts')

    // The bank is shared across tenants, and it is built only from simulations.
    // That is safe exactly as long as a simulation stays an invented scenario
    // against a synthetic persona. Seed one from persuasion_ammunition and one
    // business's approved rules start appearing in another business's matrix.
    //
    // This is the single invariant the whole persuasion design rests on, which
    // is why it is a test and not a comment.
    expect(sim).not.toMatch(/ammunition/i)
    expect(sim).not.toMatch(/tenantId|tenant_id/)
    expect(sim).not.toMatch(/assignmentId|assignment_id/)
  })

  it('holds for the loop that runs simulations unattended', () => {
    // The queue and the worker are new ways to start a simulation, and a
    // boundary that holds for the one a person clicks and not for the one a
    // cron runs is not a boundary. The worker reads personas and library plans
    // by key; the moment it could read ammunition, every unattended run becomes
    // a route for one tenant's rules into the shared bank.
    const worker = source('src/persuade/lib/worker.ts')

    expect(worker).not.toMatch(/ammunition/i)
    expect(worker).not.toMatch(/tenantId|tenant_id/)
    expect(worker).not.toMatch(/assignmentId|assignment_id/)

    // The feed decides what the loop runs next, so it is part of the same loop.
    const feed = source('src/persuade/lib/feed.ts')
    expect(feed).not.toMatch(/ammunition/i)
    expect(feed).not.toMatch(/tenantId|tenant_id/)
    expect(feed).not.toMatch(/assignmentId|assignment_id/)
  })

  it('keeps the turn-taking it drives free of them too', () => {
    // simulation.ts delegates every turn to turn.ts. A boundary that holds in
    // the caller and leaks in the callee is not a boundary.
    const turn = source('src/persuade/engine/turn.ts')

    expect(turn).not.toMatch(/tenantId|tenant_id/)
    expect(turn).not.toMatch(/assignmentId|assignment_id/)
  })
})
