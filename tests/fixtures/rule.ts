import type { Rule } from '../../src/brain/types'

/**
 * One approved-shaped rule, with every column the API selects.
 *
 * Shared because a rule grew from eight columns to sixteen in one release, and
 * a fixture per test file means the next column addition is a type error in
 * every one of them. This is the opposite call from the production normalizers,
 * which stay per-surface deliberately: there, a shared mapper becomes the union
 * of every surface's needs. A fixture has no such pull -- it is one row.
 */
export const makeRule = (overrides: Partial<Rule> = {}): Rule => ({
  id: 'rule-1',
  rule_number: 12,
  topic_id: 'store',
  sub_topic: 'קבלת פנים',
  text: 'לחייך',
  response: null,
  is_starred: false,
  created_at: '2026-08-20T10:00:00Z',
  kind: 'tip',
  polarity: null,
  status: 'pending',
  source: 'pdf',
  source_url: null,
  like_count: 3,
  vote_count: 4,
  like_pct: 75,
  ...overrides,
})
