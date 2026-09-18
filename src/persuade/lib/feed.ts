import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
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
  /** 'manual' for a hand-written row, 'generated' for one `lab:generate` wrote. */
  source: 'manual' | 'generated'
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
 * general, but only among hand-written personas: pairing it with every
 * generated one too would mean a CEO or COO answering a plan measuring
 * nothing for either of them, since neither role was who the plan was written
 * for.
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
          (plan.jobRoleName === null
            ? persona.source === 'manual'
            : persona.jobRoleName === plan.jobRoleName),
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

export interface RefillSettings {
  lowWater: number
  refillChunk: number
}

export type FeedReport =
  | { status: 'enough'; pending: number }
  | { status: 'no-pairs'; pending: number; unpairedPersonas: string[] }
  | {
      status: 'queued'
      pending: number
      queued: number
      nextIndex: number
      pass: number
      unpairedPersonas: string[]
    }
  | { status: 'lost-race'; pending: number }

async function countPending(client: SupabaseClient): Promise<number> {
  const { count, error } = await client
    .from('simulation_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
  if (error) throw new Error(`ספירת התור נכשלה: ${error.message}`)
  return count ?? 0
}

async function readInputs(
  client: SupabaseClient,
  table: 'persuasion_personas' | 'persuasion_lab_plans',
  keyColumn: 'persona_key' | 'plan_key',
): Promise<FeedInput[]> {
  const { data, error } = await client
    .from(table)
    .select(`${keyColumn},industry,job_role_name,source`)
    .eq('is_active', true)
  if (error) throw new Error(`קריאת ${table} נכשלה: ${error.message}`)
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    key: String(row[keyColumn]),
    industry: String(row.industry),
    jobRoleName: (row.job_role_name as string | null | undefined) ?? null,
    source: row.source === 'generated' ? 'generated' : 'manual',
  }))
}

interface FeedRow {
  next_index: number
  pass: number
  inputs_version: string | null
}

async function readFeed(client: SupabaseClient): Promise<FeedRow> {
  const { data, error } = await client
    .from('simulation_feed')
    .select('next_index,pass,inputs_version')
    .eq('id', 1)
    .maybeSingle()
  if (error) throw new Error(`קריאת simulation_feed נכשלה: ${error.message}`)
  if (!data) throw new Error('אין שורה ב-simulation_feed. המיגרציה לא הוחלה.')
  return data as FeedRow
}

/**
 * Tops the queue up when it runs low. Safe to call from overlapping ticks.
 *
 * The commit expects the position that was READ, even when the inputs changed
 * and planning restarted from zero: the guard is about what is stored, and two
 * ticks that both saw the old version must not both reset it.
 */
export async function refillFeed(
  client: SupabaseClient,
  settings: RefillSettings,
): Promise<FeedReport> {
  const pending = await countPending(client)
  if (pending >= settings.lowWater) return { status: 'enough', pending }

  const [personas, plans] = await Promise.all([
    readInputs(client, 'persuasion_personas', 'persona_key'),
    readInputs(client, 'persuasion_lab_plans', 'plan_key'),
  ])
  const { pairs, unpairedPersonas } = pairInputs(personas, plans)
  if (pairs.length === 0) return { status: 'no-pairs', pending, unpairedPersonas }

  const cells = worldCells()
  const stored = await readFeed(client)
  const version = inputsVersion(pairs, cells.length)
  const from =
    stored.inputs_version === version
      ? { nextIndex: stored.next_index, pass: stored.pass }
      : { nextIndex: 0, pass: 0 }

  const chunk = planChunk(from, pairs.length, cells.length, settings.refillChunk)
  const jobs = jobsForChunk(chunk, pairs, cells)

  const { data, error } = await client.rpc('commit_simulation_feed_chunk', {
    p_expected_index: stored.next_index,
    p_expected_pass: stored.pass,
    p_expected_version: stored.inputs_version,
    p_new_index: chunk.nextIndex,
    p_new_pass: chunk.pass,
    p_new_version: version,
    p_jobs: jobs,
  })
  if (error) throw new Error(`מילוי התור נכשל: ${error.message}`)
  if (data !== true) return { status: 'lost-race', pending }

  return {
    status: 'queued',
    pending,
    queued: jobs.length,
    nextIndex: chunk.nextIndex,
    pass: chunk.pass,
    unpairedPersonas,
  }
}
