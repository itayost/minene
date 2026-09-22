import { describe, expect, it } from 'vitest'
import {
  cellIndex,
  cellKey,
  industryLabel,
  placeRun,
  planKeyFor,
  type RoleNeed,
} from '../../src/persuade/cell'

const need = (industry: string, roleSlug: string, needKey: string): RoleNeed => ({
  industry,
  roleSlug,
  roleLabel: 'תפקיד',
  roleOrder: 1,
  needKey,
  needLabel: 'צורך',
  metaNeed: 'control',
})

describe('placing a run on the taxonomy', () => {
  it('finds the cell a generated plan key belongs to', () => {
    const index = cellIndex([need('retail', 'ceo', 'chain-visibility')])

    expect(placeRun(index, 'gen-retail-ceo-chain-visibility')).toMatchObject({
      industry: 'retail',
      roleSlug: 'ceo',
      needKey: 'chain-visibility',
    })
  })

  it('resolves a hyphenated slug exactly, with no splitting', () => {
    // The real content of the old test: a role slug and a need key that both
    // contain hyphens resolve correctly, because the key is looked up whole
    // rather than split on a separator that appears inside both halves.
    const index = cellIndex([need('retail', 'area-manager', 'food-waste')])

    expect(placeRun(index, 'gen-retail-area-manager-food-waste')).toMatchObject({
      roleSlug: 'area-manager',
      needKey: 'food-waste',
    })
  })

  it('refuses to place a run whose key two cells both claim', () => {
    // planKeyFor is not injective: role slugs and need keys both admit hyphens,
    // so these two needs produce one identical key. Picking either is a guess,
    // and a guessed cell is exactly what this module exists to avoid. The run
    // goes to the unplaced bucket instead, where it stays visible.
    const index = cellIndex([
      need('retail', 'area-manager', 'food-waste'),
      need('retail', 'area', 'manager-food-waste'),
    ])

    expect(placeRun(index, 'gen-retail-area-manager-food-waste')).toBeNull()
  })

  it('returns null for the hand-written plan rather than inventing a cell', () => {
    const index = cellIndex([need('retail', 'ceo', 'chain-visibility')])

    // briefings predates the taxonomy and belongs to no cell in it. Every one
    // of the 168 runs on record carries this plan id, so a version of this
    // that invented a cell would misplace the entire table.
    expect(placeRun(index, 'briefings')).toBeNull()
  })

  it('returns null for a missing plan id instead of throwing', () => {
    const index = cellIndex([need('retail', 'ceo', 'chain-visibility')])

    expect(placeRun(index, null)).toBeNull()
    expect(placeRun(index, undefined)).toBeNull()
  })

  it('writes the key the generator writes', () => {
    expect(planKeyFor(need('bank', 'branch-manager', 'service-quality'))).toBe(
      'gen-bank-branch-manager-service-quality',
    )
  })

  it('keys a cell distinctly across all three axes', () => {
    const a = cellKey(need('retail', 'ceo', 'profitability'))
    const b = cellKey(need('bank', 'ceo', 'profitability'))

    expect(a).not.toBe(b)
  })
})

describe('industry labels', () => {
  it('names all five industries in Hebrew', () => {
    // role_needs has role_label and need_label columns; the industry is a bare
    // slug with no label anywhere in the database, so the only Hebrew for it
    // lives here. A missing entry would print "infrastructure" on a screen
    // with no English surface.
    for (const industry of ['retail', 'bank', 'healthcare', 'restaurants', 'infrastructure']) {
      expect(industryLabel(industry)).toMatch(/[֐-׿]/)
    }
  })

  it('passes an unknown industry through rather than losing it', () => {
    expect(industryLabel('mining')).toBe('mining')
  })
})
