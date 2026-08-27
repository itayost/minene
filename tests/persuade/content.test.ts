import { describe, expect, test } from 'vitest';
import { isAskPhotographable } from '../../src/persuade/engine/rules';
import { getPersona, getPlan, loadPersonas, loadPlans } from '../../src/persuade/lib/content';

describe('content library', () => {
  test('every persona carries what the follow-up phase needs', async () => {
    const personas = await loadPersonas();
    expect(personas.length).toBeGreaterThanOrEqual(4);
    for (const p of personas) {
      expect(p.reliability).toBeGreaterThanOrEqual(1);
      expect(p.reliability).toBeLessThanOrEqual(5);
      expect(p.agreesWhen.length).toBeGreaterThan(0);
      expect(p.hiddenTruth.length).toBeGreaterThan(0);
    }
  });

  test('every plan ships an ask that passes the photographable gate', async () => {
    const plans = await loadPlans();
    expect(plans.length).toBeGreaterThanOrEqual(1);
    for (const plan of plans) {
      expect(isAskPhotographable(plan).ok).toBe(true);
    }
  });

  test('every plan ships a full five rung ladder', async () => {
    for (const plan of await loadPlans()) {
      expect(plan.escalation.map((e) => e.rung)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  test('looking up a missing id fails loudly', async () => {
    await expect(getPersona('nobody')).rejects.toThrow('nobody');
    await expect(getPlan('nothing')).rejects.toThrow('nothing');
  });

  test('ids are unique within each kind', async () => {
    const ids = (await loadPlans()).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('plans stay independent of who is on the other side', () => {
  /** Word boundaries matter: "ועדיין" contains "עדי" and is not a name. */
  const standalone = (name: string) =>
    new RegExp(String.raw`(?<![\u05d0-\u05ea])${name}(?![\u05d0-\u05ea])`);

  test('no plan bakes in a persona name', async () => {
    const names = (await loadPersonas()).map((p) => p.name);
    for (const plan of await loadPlans()) {
      const blob = JSON.stringify(plan);
      for (const name of names) {
        expect(standalone(name).test(blob)).toBe(false);
      }
    }
  });
});
