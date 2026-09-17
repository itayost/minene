/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { readAll } from '../scripts/lib/db'

/**
 * A server that answers a range request, capped at `maxRows` however wide the
 * request is -- which is what PostgREST does, and the case a pager written
 * against its own page size gets wrong.
 */
const server = (total: number, maxRows: number) => {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: [number, number][] = []
  const page = async (from: number, to: number) => {
    calls.push([from, to])
    return { data: rows.slice(from, Math.min(to + 1, from + maxRows)), error: null }
  }
  return { page, calls }
}

describe('reading every row', () => {
  test('does not stop on a page the server cut short', async () => {
    // The failure this replaces: advancing by the requested size and stopping
    // on any short page. With a server capped below the page size every page
    // is short, so the first one looked like the last and the report described
    // 500 rows out of 2,300 while looking exactly like a report on all of them.
    const { page } = server(2300, 500)

    const rows = await readAll(page, 1000)

    expect(rows).toHaveLength(2300)
    expect(rows.at(-1)).toEqual({ id: 2299 })
  })

  test('reads a table that ends exactly on a page boundary', async () => {
    const { page, calls } = server(2000, 1000)

    expect(await readAll(page, 1000)).toHaveLength(2000)
    // Three requests: two full pages and the empty one that proves there is
    // no third. Stopping without it means trusting a full page to be the end.
    expect(calls).toHaveLength(3)
  })

  test('returns nothing rather than looping on an empty table', async () => {
    const { page } = server(0, 1000)
    expect(await readAll(page, 1000)).toEqual([])
  })

  test('throws with the message the server gave, rather than reporting a short table', async () => {
    const failing = async () => ({ data: null, error: { message: 'timeout' } })
    await expect(readAll(failing)).rejects.toThrow('timeout')
  })
})
