/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const access = vi.hoisted(() => ({ resolveAccess: vi.fn() }))
vi.mock('../../src/persuade/lib/access', () => access)
vi.mock('../../src/persuade/lib/model', () => ({ assertModelAccessConfigured: () => undefined }))
vi.mock('../../src/persuade/lib/supabase', () => ({ supabase: () => ({}) }))
vi.mock('../../src/persuade/engine/config', () => ({ validateConfig: () => [] }))
vi.mock('../../src/persuade/lib/content', () => ({
  getPersona: async () => ({ id: 'rona', name: 'רונה', role: 'מנהלת חנות' }),
}))

const engine = vi.hoisted(() => ({ scoreRun: vi.fn(), saveSimulation: vi.fn() }))
vi.mock('../../src/persuade/engine/score', () => ({ scoreRun: engine.scoreRun }))
vi.mock('../../src/persuade/lib/simulations', () => ({
  createSimulationsStore: () => ({ saveSimulation: engine.saveSimulation }),
}))

const RUN = {
  id: 'sim-1',
  plan: { id: 'briefings' },
  turns: [],
  state: { outcome: 'agreed' },
  violations: [],
}
vi.mock('../../src/persuade/engine/simulation', () => ({
  async *runSimulation() {
    yield { type: 'turn', turn: { role: 'persuader', text: 'שלום', interaction: 1 }, state: {} }
    yield { type: 'done', run: RUN }
  },
}))

const { POST } = await import('../../app/api/persuade/simulate/route')

const post = async () => {
  const response = await POST(
    new Request('http://x/api/persuade/simulate', {
      method: 'POST',
      headers: { Authorization: 'Bearer t' },
      body: JSON.stringify({
        config: {},
        personaId: 'rona',
        cell: { industry: 'אופנה', jobRoleId: 'r1' },
      }),
    }),
  )
  const text = await response.text()
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string })
}

beforeEach(() => {
  vi.clearAllMocks()
  access.resolveAccess.mockResolvedValue({ ok: true, caller: { role: 'owner' } })
  engine.scoreRun.mockResolvedValue({ persuaded: 'yes', winningCategory: 'numbers' })
  engine.saveSimulation.mockResolvedValue(undefined)
})

describe('what the stream promises about the run being kept', () => {
  it('says saved only once the row is actually written', async () => {
    // `done` is yielded by the engine the moment the conversation ends, and the
    // scoring and the insert both happen after it. A client that reloaded on
    // `done` would re-query before the row existed and show a matrix without
    // the run it just watched -- so the stream has to say when it is kept.
    //
    // Read incrementally rather than as one string: buffering the whole body
    // waits for the stream to close, by which time an announcement made too
    // early is indistinguishable from one made at the right moment.
    let release = () => {}
    engine.saveSimulation.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = () => resolve()
        }),
    )

    const response = await POST(
      new Request('http://x/api/persuade/simulate', {
        method: 'POST',
        headers: { Authorization: 'Bearer t' },
        body: JSON.stringify({
          config: {},
          personaId: 'rona',
          cell: { industry: 'אופנה', jobRoleId: 'r1' },
        }),
      }),
    )
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let seen = ''
    const readUntil = async (needle: string) => {
      while (!seen.includes(needle)) {
        const { done, value } = await reader.read()
        if (done) return
        seen += decoder.decode(value, { stream: true })
      }
    }

    await readUntil('"done"')

    // Not `expect(seen).not.toContain('"saved"')`: the reader stops the moment
    // `done` is in hand, so an announcement already sitting in the queue would
    // simply not have been read yet, and the assertion would pass either way.
    // What has to be true is that nothing more is *ready*.
    const pending = reader.read()
    const arrival = await Promise.race([
      pending.then(() => 'arrived'),
      new Promise<'idle'>((resolve) => {
        setTimeout(() => resolve('idle'), 20)
      }),
    ])
    expect(arrival).toBe('idle')

    release()
    expect(decoder.decode((await pending).value)).toContain('"saved"')
  })

  it('says so when the write failed, rather than falling silent', async () => {
    // Ten model calls were spent. A swallowed failure leaves the screen looking
    // exactly like a successful run whose row nobody can find afterwards.
    engine.saveSimulation.mockRejectedValue(new Error('connection refused'))

    const events = await post()

    expect(events.map((e) => e.type)).toContain('unsaved')
    expect(events.map((e) => e.type)).not.toContain('saved')
  })

  it('keeps an unscored run and still reports it as saved', async () => {
    engine.scoreRun.mockRejectedValue(new Error('judge unavailable'))

    const events = await post()

    expect(events.map((e) => e.type)).toContain('unscored')
    expect(events.map((e) => e.type)).toContain('saved')
  })
})
