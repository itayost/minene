/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { fetchAll } from '../../src/persuade/lib/fetch-all'

describe('reading every row a query matches', () => {
  test('keeps paging past a source that only ever answers one page at a time', async () => {
    // Stands in for PostgREST: whatever range is asked for, it never hands
    // back more than `hardCap` rows in one response -- which is exactly what
    // a stock Supabase project does to an un-ranged `.select()`.
    const total = 2500
    const hardCap = 1000
    const all = Array.from({ length: total }, (_, i) => i)
    const calls: [number, number][] = []

    const rows = await fetchAll<number>((from, to) => {
      calls.push([from, to])
      return Promise.resolve({
        data: all.slice(from, Math.min(to + 1, from + hardCap)),
        error: null,
      })
    }, 1000)

    expect(rows).toHaveLength(total)
    expect(rows).toEqual(all)
    // Three pages for 2500 rows at 1000 a page: two full, one partial. A
    // caller that stopped after the first page -- the bug this exists to
    // rule out -- would have returned 1000, not 2500.
    expect(calls).toHaveLength(3)
  })

  test('stops as soon as a page comes back short, without an extra empty request', async () => {
    const data = [1, 2, 3]
    let calls = 0
    const rows = await fetchAll<number>((from, to) => {
      calls += 1
      return Promise.resolve({ data: data.slice(from, to + 1), error: null })
    }, 10)

    expect(rows).toEqual(data)
    expect(calls).toBe(1)
  })

  test('throws rather than reporting a partial result as though it were complete', async () => {
    await expect(
      fetchAll<number>(() => Promise.resolve({ data: null, error: { message: 'boom' } })),
    ).rejects.toThrow('boom')
  })
})
