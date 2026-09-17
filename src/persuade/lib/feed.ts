import { createHash } from 'node:crypto'
import { DEFAULT_RULES } from '../engine/rules'
import { buildWorld, type WorldCell, worldCells } from '../engine/world'
import { goldenStride, type QueuedJob } from './experiments'

/**
 * What the self-refilling queue runs next.
 *
 * The space is (persona, plan) pairs times world cells. A position in it is a
 * single integer, so "where the feed is up to" is one number in one row and a
 * compare-and-set in Postgres can guard it.
 *
 * Within one world the pairs are consecutive; across worlds the order follows
 * the same golden-ratio stride planSweep uses, so a short stretch of the feed
 * spreads over every axis instead of marching down the innermost one.
 *
 * Reads no tenant data. The inputs are the lab's own personas and plans, and
 * tests/persuade/tenant-boundary.test.ts holds this file to that.
 */

export interface FeedInput {
  key: string
  industry: string
  /** The role a persona plays, or the role a plan asks of. Null on a plan means any role. */
  jobRoleName: string | null
}

export interface FeedPair {
  personaKey: string
  planKey: string
  industry: string
}

export interface FeedPosition {
  pairIndex: number
  worldIndex: number
  pass: number
}

export interface FeedChunk {
  positions: FeedPosition[]
  nextIndex: number
  pass: number
}

const byKey = (a: FeedInput, b: FeedInput) => a.key.localeCompare(b.key)

/**
 * A persona meets a plan only when the plan could be asked of them.
 *
 * A bank manager asked to run a retail morning briefing measures nothing about
 * persuasion. A plan with no target role (the hand-written `briefings`) is
 * general and meets everyone in its industry.
 */
export function pairInputs(
  personas: readonly FeedInput[],
  plans: readonly FeedInput[],
): { pairs: FeedPair[]; unpairedPersonas: string[] } {
  const sortedPersonas = [...personas].sort(byKey)
  const pairs = [...plans].sort(byKey).flatMap((plan) =>
    sortedPersonas
      .filter(
        (persona) =>
          persona.industry === plan.industry &&
          (plan.jobRoleName === null || persona.jobRoleName === plan.jobRoleName),
      )
      .map((persona) => ({
        personaKey: persona.key,
        planKey: plan.key,
        industry: plan.industry,
      })),
  )

  const paired = new Set(pairs.map((pair) => pair.personaKey))
  return {
    pairs,
    unpairedPersonas: sortedPersonas.filter((p) => !paired.has(p.key)).map((p) => p.key),
  }
}

/**
 * What a stored index refers to. Includes the world count because adding a
 * world axis changes the space without changing a single persona or plan.
 */
export function inputsVersion(pairs: readonly FeedPair[], worldCount: number): string {
  const canonical = pairs
    .map((pair) => `${pair.industry}:${pair.planKey}:${pair.personaKey}`)
    .sort()
    .join('\n')
  return createHash('sha256').update(`${worldCount}\n${canonical}`).digest('hex').slice(0, 16)
}

export function planChunk(
  from: { nextIndex: number; pass: number },
  pairCount: number,
  worldCount: number,
  take: number,
): FeedChunk {
  const total = pairCount * worldCount
  if (total === 0) return { positions: [], nextIndex: 0, pass: from.pass }

  const stride = goldenStride(worldCount)
  // Capped at one pass: a chunk larger than the space would queue the same
  // cell twice in one insert, which is a repeat nobody asked for yet.
  const count = Math.min(Math.max(0, take), total)

  const positions = Array.from({ length: count }, (_, offset): FeedPosition => {
    const absolute = from.nextIndex + offset
    const index = absolute % total
    return {
      pairIndex: index % pairCount,
      worldIndex: (Math.floor(index / pairCount) * stride) % worldCount,
      pass: from.pass + Math.floor(absolute / total),
    }
  })

  const end = from.nextIndex + count
  return { positions, nextIndex: end % total, pass: from.pass + Math.floor(end / total) }
}

export function jobsForChunk(
  chunk: FeedChunk,
  pairs: readonly FeedPair[],
  cells: readonly WorldCell[] = worldCells(),
): QueuedJob[] {
  return chunk.positions.map((position) => {
    const pair = pairs[position.pairIndex] as FeedPair
    const cell = cells[position.worldIndex] as WorldCell
    return {
      experiment: null,
      variant: null,
      persona_key: pair.personaKey,
      plan_key: pair.planKey,
      industry: pair.industry,
      segment: null,
      job_role_id: null,
      need: cell.reason,
      rules: DEFAULT_RULES,
      world: buildWorld(cell),
      pass: position.pass,
    }
  })
}
