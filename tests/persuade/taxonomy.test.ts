import { describe, expect, it } from 'vitest'
import { type NeedRow, taxonomyFrom } from '../../src/persuade/taxonomy'

const row = (
  industry: string,
  roleSlug: string,
  roleOrder: number,
  needKey: string,
  needOrder: number,
): NeedRow => ({
  industry,
  roleSlug,
  roleLabel: `תפקיד ${roleSlug}`,
  roleOrder,
  needKey,
  needLabel: `צורך ${needKey}`,
  needOrder,
  metaNeed: 'control',
})

describe('building the taxonomy tree', () => {
  it('nests needs under roles under industries', () => {
    const tree = taxonomyFrom([
      row('retail', 'ceo', 1, 'profitability', 1),
      row('retail', 'ceo', 1, 'chain-visibility', 2),
      row('retail', 'store-manager', 2, 'daily-targets', 1),
    ])

    expect(tree).toHaveLength(1)
    expect(tree[0]?.roles).toHaveLength(2)
    expect(tree[0]?.roles[0]?.needs.map((n) => n.needKey)).toEqual([
      'profitability',
      'chain-visibility',
    ])
  })

  it('orders roles by role_order and needs by need_order, not alphabetically', () => {
    // The order is the org chart and the priority list. Sorting these by label
    // would put the stockroom above the CEO and make the screen unreadable as
    // a hierarchy.
    const tree = taxonomyFrom([
      row('retail', 'zeta-role', 1, 'zeta-need', 1),
      row('retail', 'alpha-role', 2, 'alpha-need', 2),
      row('retail', 'zeta-role', 1, 'alpha-need', 2),
    ])

    expect(tree[0]?.roles.map((r) => r.roleSlug)).toEqual(['zeta-role', 'alpha-role'])
    expect(tree[0]?.roles[0]?.needs.map((n) => n.needKey)).toEqual(['zeta-need', 'alpha-need'])
  })

  it('carries every industry, including ones nobody has run', () => {
    // The whole point of reading structure from role_needs rather than from the
    // runs: an industry with no runs is a hole, and a hole is the most useful
    // thing this screen can show.
    const tree = taxonomyFrom([
      row('retail', 'ceo', 1, 'profitability', 1),
      row('infrastructure', 'ceo', 1, 'uptime', 1),
    ])

    expect(tree.map((t) => t.industry).sort()).toEqual(['infrastructure', 'retail'])
  })

  it('labels each industry in Hebrew', () => {
    const tree = taxonomyFrom([row('infrastructure', 'ceo', 1, 'uptime', 1)])

    expect(tree[0]?.label).toMatch(/[֐-׿]/)
  })

  it('returns an empty tree for no rows rather than throwing', () => {
    expect(taxonomyFrom([])).toEqual([])
  })
})
