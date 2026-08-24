import { describe, expect, it, vi } from 'vitest'
import { loadAllPending } from '../../app/[brandId]/tools/brain/lobby/lobby-client'
import type { RulesApi } from '../../src/brain/rules-api'
import type { Rule } from '../../src/brain/types'

const rule = (id: string): Rule => ({
  id,
  topic_id: 'store',
  text: `חוק ${id}`,
  is_starred: false,
  created_at: '2026-08-20T10:00:00Z',
  kind: 'tip',
  status: 'pending',
  source: 'pdf',
})

describe('loadAllPending', () => {
  it('pages until the cursor runs out, rather than stopping at the first page', async () => {
    const listPendingRules = vi.fn()
      .mockResolvedValueOnce({ rows: [rule('a')], nextCursor: { created_at: 'T', id: 'a' } })
      .mockResolvedValueOnce({ rows: [rule('b')], nextCursor: { created_at: 'T', id: 'b' } })
      .mockResolvedValueOnce({ rows: [rule('c')], nextCursor: null })

    const rows = await loadAllPending({ listPendingRules } as unknown as RulesApi)

    // The per-topic fan-out this replaced capped each topic at 50 with no cursor
    // to page past, so once a topic held more than 50 pending rows the oldest
    // were silently unreachable. Stopping early here would reintroduce that.
    expect(listPendingRules).toHaveBeenCalledTimes(3)
    expect(rows.map((row) => row.id)).toEqual(['a', 'b', 'c'])
  })

  it('carries each page cursor into the next request', async () => {
    const listPendingRules = vi.fn()
      .mockResolvedValueOnce({ rows: [rule('a')], nextCursor: { created_at: 'T1', id: 'a' } })
      .mockResolvedValueOnce({ rows: [], nextCursor: null })

    await loadAllPending({ listPendingRules } as unknown as RulesApi)

    expect(listPendingRules).toHaveBeenNthCalledWith(2, { cursor: { created_at: 'T1', id: 'a' } })
  })

  it('returns nothing when the lobby is empty', async () => {
    const listPendingRules = vi.fn().mockResolvedValue({ rows: [], nextCursor: null })

    await expect(loadAllPending({ listPendingRules } as unknown as RulesApi)).resolves.toEqual([])
  })
})
