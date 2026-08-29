import { describe, expect, it, vi } from 'vitest'
import { loadAllPending } from '../../app/[brandId]/tools/brain/ingest/ingest-client'
import type { RulesApi } from '../../src/brain/rules-api'
import { makeRule } from '../fixtures/rule'

const rule = (id: string) => makeRule({ id, text: `חוק ${id}` })

describe('loadAllPending', () => {
  it('pages until the cursor runs out, rather than stopping at the first page', async () => {
    const listPendingRules = vi
      .fn()
      .mockResolvedValueOnce({ rows: [rule('a')], nextCursor: { created_at: 'T', id: 'a' } })
      .mockResolvedValueOnce({ rows: [rule('b')], nextCursor: { created_at: 'T', id: 'b' } })
      .mockResolvedValueOnce({ rows: [rule('c')], nextCursor: null })

    const { rows, hasMore } = await loadAllPending({ listPendingRules } as unknown as RulesApi)

    // The per-topic fan-out this replaced capped each topic at 50 with no cursor
    // to page past, so once a topic held more than 50 pending rows the oldest
    // were silently unreachable. Stopping early inside the cap would reintroduce
    // that.
    expect(listPendingRules).toHaveBeenCalledTimes(3)
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c'])
    expect(hasMore).toBe(false)
  })

  it('carries each page cursor into the next request', async () => {
    const listPendingRules = vi
      .fn()
      .mockResolvedValueOnce({ rows: [rule('a')], nextCursor: { created_at: 'T1', id: 'a' } })
      .mockResolvedValueOnce({ rows: [], nextCursor: null })

    await loadAllPending({ listPendingRules } as unknown as RulesApi)

    expect(listPendingRules).toHaveBeenNthCalledWith(2, { cursor: { created_at: 'T1', id: 'a' } })
  })

  it('returns nothing when the queue is empty', async () => {
    const listPendingRules = vi.fn().mockResolvedValue({ rows: [], nextCursor: null })

    await expect(loadAllPending({ listPendingRules } as unknown as RulesApi)).resolves.toEqual({
      rows: [],
      hasMore: false,
    })
  })

  it('stops at the cap and says the queue did not end there', async () => {
    // A cursor that never runs out. Unbounded, this is thirteen sequential RPCs
    // for a 600-rule queue on every page load, and then every id in one in(...)
    // filter whose URL a proxy refuses.
    const listPendingRules = vi.fn().mockResolvedValue({
      rows: [rule('a')],
      nextCursor: { created_at: 'T', id: 'a' },
    })

    const { hasMore } = await loadAllPending({ listPendingRules } as unknown as RulesApi)

    expect(listPendingRules).toHaveBeenCalledTimes(4)
    // Never a silent truncation: the screen says the list stopped.
    expect(hasMore).toBe(true)
  })
})
