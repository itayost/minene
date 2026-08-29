/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

/**
 * The lab's content loader, now reading rows instead of files.
 *
 * What moved out of this file: the invariants about the content itself --
 * every plan passing the photographable gate, no plan naming a persona. Those
 * were assertions about four committed JSON files, and the files are no longer
 * what runs. They live in `scripts/validate-lab-content.ts` now, which checks
 * the rows the lab actually reads. A unit test cannot reach them without a
 * database, and a test that silently skips itself is worse than a command
 * someone runs.
 *
 * What stayed: everything that is a contract of this module rather than a fact
 * about the data.
 */

const PERSONA_ROW = {
  persona_key: 'adi',
  name: 'עדי',
  role: 'מנהלת חנות ביגוד ילדים',
  resistance: 3,
  reliability: 3,
  situation: 'קולקציה חדשה הרגע הגיעה',
  hidden_truth: 'את עושה תדריך פעמיים בשבוע, לא כל יום',
  motivated_by: ['הצוות שלה', 'שלא יהיה בלגן'],
  style: 'ישירה',
  agrees_when: 'הבקשה קטנה ומדויקת',
}

const PLAN_ROW = {
  plan_key: 'briefings',
  plan: { id: 'whatever-was-stored', topic: 'תדריכי בוקר', escalation: [] },
}

/** Records what was selected, which is how the hiddenTruth guarantee is checked. */
function fakeDb(rows: Record<string, unknown[]>) {
  const selects: Record<string, string[]> = {}
  const supabase = () => ({
    from(table: string) {
      const chain = {
        select(columns: string) {
          selects[table] ??= []
          selects[table].push(columns)
          return chain
        },
        eq(column: string, value: unknown) {
          if (column !== 'is_active') {
            const key = table === 'persuasion_personas' ? 'persona_key' : 'plan_key'
            chain._filtered = (rows[table] ?? []).filter(
              (r) => (r as Record<string, unknown>)[key] === value,
            )
          }
          return chain
        },
        order: () => chain,
        maybeSingle: async () => ({ data: (chain._filtered ?? [])[0] ?? null, error: null }),
        then: undefined as never,
        _filtered: undefined as unknown[] | undefined,
      }
      // The list paths await the builder itself rather than maybeSingle().
      return Object.assign(chain, {
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: chain._filtered ?? rows[table] ?? [], error: null }),
      })
    },
  })
  return { supabase, selects }
}

async function loadWith(rows: Record<string, unknown[]>) {
  const { supabase, selects } = fakeDb(rows)
  vi.doMock('../../src/persuade/lib/supabase', () => ({
    supabase,
    isStorageConfigured: () => true,
  }))
  const mod = await import('../../src/persuade/lib/content')
  return { ...mod, selects }
}

afterEach(() => {
  vi.resetModules()
  vi.doUnmock('../../src/persuade/lib/supabase')
})

describe('reading a persona', () => {
  test('maps the row onto the shape the engine expects', async () => {
    const { getPersona } = await loadWith({ persuasion_personas: [PERSONA_ROW] })

    const persona = await getPersona('adi')

    // snake_case in the database, camelCase in the engine. This mapping is the
    // whole job of the module and the thing most likely to be wrong.
    expect(persona.id).toBe('adi')
    expect(persona.hiddenTruth).toBe(PERSONA_ROW.hidden_truth)
    expect(persona.agreesWhen).toBe(PERSONA_ROW.agrees_when)
    expect(persona.motivatedBy).toEqual(PERSONA_ROW.motivated_by)
  })

  test('a null motivated_by reads as no motivations, not a crash', async () => {
    const { getPersona } = await loadWith({
      persuasion_personas: [{ ...PERSONA_ROW, motivated_by: null }],
    })

    expect((await getPersona('adi')).motivatedBy).toEqual([])
  })

  test('looking up a missing id fails loudly, naming it', async () => {
    const { getPersona, getPlan } = await loadWith({
      persuasion_personas: [],
      persuasion_lab_plans: [],
    })

    await expect(getPersona('nobody')).rejects.toThrow('nobody')
    await expect(getPlan('nothing')).rejects.toThrow('nothing')
  })
})

describe('reading a plan', () => {
  test('the row key wins over whatever id the stored json carries', async () => {
    const { getPlan } = await loadWith({ persuasion_lab_plans: [PLAN_ROW] })

    // A run is recorded under plan_key. If the jsonb's own `id` drifted from it
    // -- and nothing stops that, the plan is opaque to the database -- the run
    // would be filed under an id that matches no row.
    expect((await getPlan('briefings')).id).toBe('briefings')
  })
})

describe('the persona list the picker gets', () => {
  test('never fetches hiddenTruth at all', async () => {
    const { listPersonaOptions, selects } = await loadWith({
      persuasion_personas: [PERSONA_ROW],
    })

    await listPersonaOptions()

    // hiddenTruth is what the target knows and the persuader has to work out.
    // The lab page is a server component, so anything it holds is serialised
    // into the HTML. Selected narrowly rather than mapped down afterwards, so
    // the secret never leaves the database on this path -- which is a stronger
    // guarantee than dropping it in JavaScript, and this asserts the stronger
    // one.
    const columns = selects.persuasion_personas?.join(' ') ?? ''
    expect(columns).not.toContain('hidden_truth')
    expect(columns).not.toContain('agrees_when')
    expect(columns).toContain('name')
    expect(columns).toContain('role')
  })

  test('carries a name and a role, so an option can be read', async () => {
    const { listPersonaOptions } = await loadWith({ persuasion_personas: [PERSONA_ROW] })

    const options = await listPersonaOptions()

    expect(options).toEqual([{ id: 'adi', name: 'עדי', role: 'מנהלת חנות ביגוד ילדים' }])
  })
})
