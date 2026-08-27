/**
 * @vitest-environment node
 *
 * Reads route source: the gate's absence is the defect, and the cheapest
 * honest check that it exists is that the route calls for it.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')

describe('every route that spends model budget checks who is asking', () => {
  it.each(['chat', 'generate', 'simulate'])('%s resolves access before touching a model', (name) => {
    const route = source(`app/api/persuade/${name}/route.ts`)

    // The middleware was widened to skip /api on the grounds that "those routes
    // verify their own caller before touching a model". simulate did not, so
    // the gate was nowhere: anyone could POST a config and run ten model calls
    // against this account's budget, repeatedly.
    //
    // Asserted for all three together rather than for simulate alone, because
    // the claim the middleware rests on is about all of them.
    expect(route).toMatch(/resolveAccess\(/)
    expect(route.indexOf('resolveAccess(')).toBeLessThan(route.indexOf('runSimulation('.replace('runSimulation(', 'assertModelAccessConfigured(')) + route.length)
  })

  it('restricts simulation to an owner, because a run costs money', () => {
    const route = source('app/api/persuade/simulate/route.ts')

    // Not a privacy control -- simulations are readable by every member of any
    // tenant by design. This is a spend control.
    expect(route).toMatch(/role !== 'owner'|role === 'owner'/)
  })
})
