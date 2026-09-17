/**
 * @vitest-environment node
 */
import { describe, expect, test } from 'vitest'
import { DEFAULT_RULES } from '../../src/persuade/engine/rules'
import { worldCells } from '../../src/persuade/engine/world'
import {
  type FeedInput,
  inputsVersion,
  jobsForChunk,
  pairInputs,
  planChunk,
} from '../../src/persuade/lib/feed'

const persona = (key: string, industry: string, jobRoleName: string | null): FeedInput => ({
  key,
  industry,
  jobRoleName,
})

describe('pairInputs', () => {
  test('a plan with a target role meets only personas in that role and industry', () => {
    const { pairs, unpairedPersonas } = pairInputs(
      [
        persona('a', 'retail', 'מנהל חנות'),
        persona('b', 'retail', 'עובד / מוכר'),
        persona('c', 'bank', 'מנהל חנות'),
      ],
      [persona('plan-1', 'retail', 'מנהל חנות')],
    )
    expect(pairs).toEqual([{ personaKey: 'a', planKey: 'plan-1', industry: 'retail' }])
    expect(unpairedPersonas).toEqual(['b', 'c'])
  })

  test('a plan with no target role meets every persona in its industry', () => {
    // This is the manual `briefings` plan, and why the feed has work before
    // any content is generated.
    const { pairs } = pairInputs(
      [
        persona('yossi', 'retail', 'עובד מכירות ותיק'),
        persona('adi', 'retail', 'מנהלת'),
        persona('x', 'bank', null),
      ],
      [persona('briefings', 'retail', null)],
    )
    expect(pairs.map((p) => p.personaKey)).toEqual(['adi', 'yossi'])
  })

  test('pair order does not depend on the order rows came back in', () => {
    const personas = [persona('b', 'retail', null), persona('a', 'retail', null)]
    const plans = [persona('p2', 'retail', null), persona('p1', 'retail', null)]
    expect(pairInputs(personas, plans).pairs).toEqual(
      pairInputs([...personas].reverse(), [...plans].reverse()).pairs,
    )
  })
})

describe('inputsVersion', () => {
  test('is stable under reordering and changes when pairs or the world count change', () => {
    const one = [
      { personaKey: 'a', planKey: 'p', industry: 'retail' },
      { personaKey: 'b', planKey: 'p', industry: 'retail' },
    ]
    expect(inputsVersion(one, 324)).toBe(inputsVersion([...one].reverse(), 324))
    expect(inputsVersion(one, 324)).toMatch(/^[0-9a-f]{16}$/)
    expect(inputsVersion(one, 324)).not.toBe(inputsVersion(one.slice(0, 1), 324))
    expect(inputsVersion(one, 324)).not.toBe(inputsVersion(one, 648))
  })
})

describe('planChunk', () => {
  test('walks every pair within a world before moving to the next world', () => {
    const chunk = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 3)
    expect(chunk.positions.map((p) => [p.pairIndex, p.worldIndex])).toEqual([
      [0, 0],
      [1, 0],
      [0, chunk.positions[2]?.worldIndex],
    ])
    expect(chunk.positions[2]?.worldIndex).not.toBe(0)
    expect(chunk.nextIndex).toBe(3)
    expect(chunk.pass).toBe(0)
  })

  test('resumes from the stored index', () => {
    const first = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 10)
    const second = planChunk({ nextIndex: first.nextIndex, pass: first.pass }, 2, 324, 10)
    const both = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 20)
    expect([...first.positions, ...second.positions]).toEqual(both.positions)
  })

  test('wraps at the end and counts the pass', () => {
    const total = 2 * 324
    const chunk = planChunk({ nextIndex: total - 1, pass: 3 }, 2, 324, 2)
    expect(chunk.positions.map((p) => p.pass)).toEqual([3, 4])
    expect(chunk.nextIndex).toBe(1)
    expect(chunk.pass).toBe(4)
  })

  test('one full pass visits every (pair, world) exactly once', () => {
    const chunk = planChunk({ nextIndex: 0, pass: 0 }, 2, 324, 2 * 324)
    const seen = new Set(chunk.positions.map((p) => `${p.pairIndex}:${p.worldIndex}`))
    expect(seen.size).toBe(648)
    expect(chunk.nextIndex).toBe(0)
    expect(chunk.pass).toBe(1)
  })

  test('never takes more than one pass in a single chunk', () => {
    expect(planChunk({ nextIndex: 0, pass: 0 }, 1, 324, 10_000).positions).toHaveLength(324)
  })

  test('an empty space yields nothing', () => {
    expect(planChunk({ nextIndex: 0, pass: 2 }, 0, 324, 50)).toEqual({
      positions: [],
      nextIndex: 0,
      pass: 2,
    })
  })
})

describe('jobsForChunk', () => {
  test('builds queue rows with the world, its reason and the pass', () => {
    const pairs = [{ personaKey: 'adi', planKey: 'briefings', industry: 'retail' }]
    const cells = worldCells()
    const chunk = planChunk({ nextIndex: 0, pass: 1 }, 1, cells.length, 1)
    const [job] = jobsForChunk(chunk, pairs, cells)

    expect(job).toMatchObject({
      experiment: null,
      variant: null,
      persona_key: 'adi',
      plan_key: 'briefings',
      industry: 'retail',
      segment: null,
      job_role_id: null,
      need: cells[0]?.reason,
      rules: DEFAULT_RULES,
      pass: 1,
    })
    expect(job?.world).not.toBeNull()
  })
})
