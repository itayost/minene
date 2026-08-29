import { NextResponse } from 'next/server'
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model'
import { supabase } from '../../../../src/persuade/lib/supabase'
import { tick } from '../../../../src/persuade/lib/worker'

/**
 * The tick the cron hits. One batch of simulations, then it returns.
 *
 * Batches are small and the schedule is what makes it continuous, rather than
 * one long-running job: a function that runs for twenty minutes is a function
 * that gets killed at nineteen with nothing recorded, and the queue exists so
 * that a killed worker loses at most the batch in flight.
 */
export const maxDuration = 800

/**
 * Vercel signs its cron requests with CRON_SECRET. Without this check the route
 * is an unauthenticated way for anyone to spend the model budget, which is
 * worse than the usual open-endpoint problem because it costs money per call
 * rather than per byte.
 *
 * There is no session here on purpose -- a cron has no user -- so this is the
 * only thing standing in front of it.
 */
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function run(req: Request) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'לא מורשה' }, { status: 401 })
  }

  try {
    assertModelAccessConfigured()
    const report = await tick(supabase())
    return NextResponse.json(report)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'שגיאה לא ידועה'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// Vercel Cron issues GET. POST is here so a batch can be kicked by hand with
// the same secret, which is how you drain a queue without waiting for the hour.
export const GET = run
export const POST = run
