import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { PersuasionPlan, TargetPersona } from '../engine/types';

/**
 * Committed content, read once and cached. Nothing here is written at runtime --
 * a batch run a week later differs because the engine changed, not because the
 * inputs were regenerated.
 */

const ROOT = path.join(process.cwd(), 'content');
const cache = new Map<string, unknown[]>();

async function loadKind<T>(kind: string): Promise<T[]> {
  const hit = cache.get(kind);
  if (hit) return hit as T[];

  const dir = path.join(ROOT, kind);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const items = await Promise.all(
    files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8')) as T),
  );
  cache.set(kind, items);
  return items;
}

function pick<T extends { id: string }>(items: T[], id: string, kind: string): T {
  const found = items.find((i) => i.id === id);
  if (!found) throw new Error(`לא נמצא ${kind} בשם "${id}"`);
  return found;
}

export const loadPersonas = (): Promise<TargetPersona[]> => loadKind<TargetPersona>('personas');
export const loadPlans = (): Promise<PersuasionPlan[]> => loadKind<PersuasionPlan>('plans');

export async function getPersona(id: string): Promise<TargetPersona> {
  return pick(await loadPersonas(), id, 'דמות');
}

export async function getPlan(id: string): Promise<PersuasionPlan> {
  return pick(await loadPlans(), id, 'תוכנית');
}

/**
 * What the lab's persona picker gets: enough to read an option, and nothing
 * else. `hiddenTruth` is what the target knows and the persuader has to work
 * out, and the lab page is a server component -- handing the client a whole
 * persona would print the answer to every simulation into the page source.
 */
export async function listPersonaOptions(): Promise<Pick<TargetPersona, 'id' | 'name' | 'role'>[]> {
  return (await loadPersonas()).map(({ id, name, role }) => ({ id, name, role }));
}
