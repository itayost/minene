import type { BotConfig } from '../../../../src/persuade/engine/config';
import { validateConfig } from '../../../../src/persuade/engine/config';
import { runSimulation } from '../../../../src/persuade/engine/simulation';
import { resolveAccess } from '../../../../src/persuade/lib/access';
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
    // Before anything, and before the model is touched.
    //
    // This route had no gate at all while the middleware was widened to skip
    // /api on the grounds that "those routes verify their own caller" -- true
    // of chat and generate, and false here. Anyone could POST a config and run
    // ten model calls against this account, repeatedly, at maxDuration 800.
    //
    // No assignmentId: a simulation is an invented scenario with no assignee,
    // which resolveAccess already treats as its own case.
    const access = await resolveAccess(req.headers.get('authorization') ?? '', undefined);
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status });
    }

    // Owner only, and this is a spend control rather than a privacy one: the
    // simulations table is deliberately readable by every member of any tenant,
    // because that is what makes a cross-industry matrix possible. What costs
    // money is producing a row, not reading one.
    if (access.caller?.role !== 'owner') {
      return Response.json({ error: 'רק בעלים יכול להריץ סימולציה.' }, { status: 403 });
    }

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
            if (event.type === 'done') await saveRun(event.run, access.context).catch(() => undefined);
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
