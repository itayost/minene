/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setModelOverrides } from '../../src/persuade/lib/model';
import { PERSUADER_PAYLOAD, streamingJsonModel, TEST_PLAN } from './helpers';

/**
 * The chat route's wire format.
 *
 * It used to answer with one JSON body, which cannot leave the server until its
 * last field is written -- so the person watched "חושבת…" for the whole
 * generation no matter how fast the model was. It now answers NDJSON, the same
 * protocol /api/persuade/simulate has always used, and this file is the contract
 * between it and persuader-api.ts.
 */

const resolveAccess = vi.fn();
const planFor = vi.fn();
const saveRun = vi.fn(async (..._args: unknown[]) => undefined);
const recordAsked = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('../../src/persuade/lib/access', () => ({ resolveAccess: (...a: unknown[]) => resolveAccess(...a) }));
vi.mock('../../src/persuade/lib/plans', () => ({
  createPlanStore: () => ({ read: async () => null, write: async () => undefined }),
  planFor: (...a: unknown[]) => planFor(...a),
}));
vi.mock('../../src/persuade/engine/ammunition', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadAmmunition: async () => ({ ask: { topicId: 'briefing', text: 'תדריך' }, assignee: {} }),
}));
vi.mock('../../src/persuade/lib/supabase', () => ({
  supabase: () => ({}),
  isStorageConfigured: () => true,
}));
vi.mock('../../src/persuade/lib/store', () => ({ saveRun: (...a: unknown[]) => saveRun(...a) }));
vi.mock('../../src/persuade/lib/assignments', () => ({ recordAsked: (...a: unknown[]) => recordAsked(...a) }));

const { POST } = await import('../../app/api/persuade/chat/route');

const ASSIGNMENT = '11111111-1111-1111-1111-111111111111';

const call = (body: unknown) =>
  POST(new Request('https://minene.test/api/persuade/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer t' },
    body: JSON.stringify(body),
  }));

/** Every NDJSON line the response carried, in order. */
async function events(response: Response): Promise<{ type: string; [key: string]: unknown }[]> {
  const text = await response.text();
  return text.split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as { type: string });
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAccess.mockResolvedValue({
    ok: true,
    caller: { tenantId: 'tenant', role: 'owner' },
    context: { tenantId: 'tenant', assignmentId: ASSIGNMENT, channel: 'in_app' },
  });
  planFor.mockResolvedValue(TEST_PLAN);
  setModelOverrides({ persuader: streamingJsonModel(PERSUADER_PAYLOAD) });
});

afterEach(() => setModelOverrides({}));

describe('the chat route', () => {
  it('streams the message and then the graded turn', async () => {
    const response = await call({ assignmentId: ASSIGNMENT, turns: [] });

    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');

    const lines = await events(response);
    expect(lines.filter((e) => e.type === 'delta').length).toBeGreaterThan(1);

    const last = lines.at(-1);
    expect(last?.type).toBe('result');
    // The turn list is the whole conversation, which is what the client posts
    // back on the next message. A stream that only emitted text would leave the
    // client to reassemble a turn it has no fields for.
    expect((last as unknown as { turns: { text: string }[] }).turns.at(-1)?.text)
      .toBe(PERSUADER_PAYLOAD.message);
  });

  it('says it is preparing before it builds a plan', async () => {
    const lines = await events(await call({ assignmentId: ASSIGNMENT, turns: [] }));

    // The one slow moment left, and it happens once per assignment rather than
    // once per message. Naming it is the difference between a wait and a
    // hang.
    expect(lines[0]?.type).toBe('preparing');
    expect(lines.findIndex((e) => e.type === 'preparing'))
      .toBeLessThan(lines.findIndex((e) => e.type === 'delta'));
  });

  it('builds the plan once per request and never takes one from the caller', async () => {
    // A client-supplied plan would be a client choosing which arguments the bot
    // may make. The route ignores the body and derives it from the assignment.
    await events(await call({ assignmentId: ASSIGNMENT, turns: [] }));

    expect(planFor).toHaveBeenCalledTimes(1);
    expect(planFor.mock.calls[0]?.[2]).toBe('tenant');
  });

  it('refuses with a status, not with a hopeful 200', async () => {
    resolveAccess.mockResolvedValue({ ok: false, status: 401, error: 'צריך להתחבר.' });

    const response = await call({ assignmentId: ASSIGNMENT, turns: [] });

    // An expired session has to be able to send someone to sign in, and it
    // cannot do that from inside a stream that has already committed to 200.
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'צריך להתחבר.' });
  });

  it('reports a mid-stream failure as an event rather than a dropped body', async () => {
    planFor.mockRejectedValue(new Error('הידע הארגוני לא נקרא'));

    const lines = await events(await call({ assignmentId: ASSIGNMENT, turns: [] }));

    // By the time the plan is built the response has already begun, so the
    // status line is long gone. A throw here would close the body mid-answer,
    // which the client cannot tell apart from the network dropping.
    expect(lines.at(-1)).toEqual({ type: 'error', message: 'הידע הארגוני לא נקרא' });
  });

  it('finishing answers on the same channel, and settles nothing', async () => {
    const lines = await events(await call({
      assignmentId: ASSIGNMENT,
      turns: [{ role: 'persuader', text: 'שלום', interaction: 0 }],
      finish: true,
    }));

    // Same protocol for the path that never touches a model, so the client has
    // one reader instead of a guess about which format is coming.
    expect(lines.at(-1)?.type).toBe('result');
    expect(lines.at(-1)).toHaveProperty('run');
    expect(saveRun).toHaveBeenCalled();
    expect(recordAsked).toHaveBeenCalled();
  });
});
