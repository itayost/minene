import type { BotConfig } from '../../../../src/persuade/engine/config'
import { validateConfig } from '../../../../src/persuade/engine/config'
import { runSimulation } from '../../../../src/persuade/engine/simulation'
import { resolveAccess } from '../../../../src/persuade/lib/access'
import { getPersona } from '../../../../src/persuade/lib/content'
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model'
import { scoreRun } from '../../../../src/persuade/engine/score'
import { createSimulationsStore } from '../../../../src/persuade/lib/simulations'
import { supabase } from '../../../../src/persuade/lib/supabase'

export const maxDuration = 800

interface SimulateRequest {
  config: BotConfig
  personaId: string
  /**
   * Where this run belongs in the matrix. Required: a run with no cell is a
   * run nothing can ever read, since the matrix and the bank are both queries
   * by cell.
   */
  cell: { industry: string; jobRoleId: string | null; need?: string | null }
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
    const access = await resolveAccess(req.headers.get('authorization') ?? '', undefined)
    if (!access.ok) {
      return Response.json({ error: access.error }, { status: access.status })
    }

    // Owner only, and this is a spend control rather than a privacy one: the
    // simulations table is deliberately readable by every member of any tenant,
    // because that is what makes a cross-industry matrix possible. What costs
    // money is producing a row, not reading one.
    if (access.caller?.role !== 'owner') {
      return Response.json({ error: 'רק בעלים יכול להריץ סימולציה.' }, { status: 403 })
    }

    assertModelAccessConfigured()
    const { config, personaId, cell } = (await req.json()) as SimulateRequest

    if (!cell?.industry?.trim()) {
      return Response.json({ error: 'חסר ענף לסימולציה.' }, { status: 400 })
    }

    const problems = validateConfig(config)
    if (problems.length > 0) {
      return Response.json({ error: problems.map((p) => p.message).join(' · ') }, { status: 400 })
    }

    const persona = await getPersona(personaId)
    const encoder = new TextEncoder()

    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of runSimulation({
            plan: config.plan,
            persona,
            rules: config.rules,
          })) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
            if (event.type !== 'done') continue

            /**
             * Scored before it is stored, and stored to `simulations` rather
             * than to `conversations`.
             *
             * The bank is built from `score.winningCategory`, so a run saved
             * unscored is a run the bank can never see -- and the conversations
             * table has no score column at all, which is why this has its own.
             *
             * A scoring failure is not a failed simulation: the conversation
             * happened, and losing it because the judge was unavailable would
             * throw away the expensive half to protect the cheap one.
             */
            let scored = event.run
            try {
              const score = await scoreRun(
                event.run.plan,
                event.run.turns,
                event.run.state,
                event.run.violations,
              )
              scored = { ...event.run, score }
            } catch {
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'unscored' })}\n`))
            }

            /**
             * Announced only once the row exists.
             *
             * `done` is yielded by the engine the moment the conversation ends,
             * and both the scoring and the insert happen after it -- so a client
             * that reloaded on `done` would re-query before the row was written
             * and show a matrix missing the run it had just watched.
             *
             * A failed write is said out loud rather than swallowed: ten model
             * calls were spent, and silence here looks exactly like a run whose
             * row nobody can find afterwards.
             */
            try {
              await createSimulationsStore(supabase()).saveSimulation(scored, cell)
              controller.enqueue(
                encoder.encode(`${JSON.stringify({ type: 'saved', id: scored.id })}\n`),
              )
            } catch {
              controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'unsaved' })}\n`))
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'שגיאה בשיחה'
          controller.enqueue(encoder.encode(`${JSON.stringify({ type: 'error', message })}\n`))
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה לא ידועה'
    return Response.json({ error: message }, { status: 500 })
  }
}
