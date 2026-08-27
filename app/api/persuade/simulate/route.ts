import type { BotConfig } from '../../../../src/persuade/engine/config';
import { validateConfig } from '../../../../src/persuade/engine/config';
import { runSimulation } from '../../../../src/persuade/engine/simulation';
import { getPersona } from '../../../../src/persuade/lib/content';
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model';
import { saveRun } from '../../../../src/persuade/lib/store';

export const maxDuration = 800;

interface SimulateRequest {
  config: BotConfig;
  personaId: string;
}

/** Bot to bot. Streams NDJSON so the conversation can be watched message by message. */
export async function POST(req: Request) {
  try {
    assertModelAccessConfigured();
    const { config, personaId } = (await req.json()) as SimulateRequest;

    const problems = validateConfig(config);
    if (problems.length > 0) {
      return Response.json({ error: problems.map((p) => p.message).join(' · ') }, { status: 400 });
    }

    const persona = await getPersona(personaId);
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of runSimulation({
            plan: config.plan,
            persona,
            rules: config.rules,
          })) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
            if (event.type === 'done') await saveRun(event.run).catch(() => undefined);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'שגיאה בשיחה';
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה לא ידועה';
    return Response.json({ error: message }, { status: 500 });
  }
}
