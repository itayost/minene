import { NextResponse } from 'next/server'
import { preparePlan } from '../../../../src/persuade/engine/prepare'
import { loadAmmunition, CrossTenantError } from '../../../../src/persuade/engine/ammunition'
import { assertModelAccessConfigured } from '../../../../src/persuade/lib/model'
import { resolveAccess } from '../../../../src/persuade/lib/access'
import { isStorageConfigured, supabase } from '../../../../src/persuade/lib/supabase'

export const maxDuration = 300

interface GenerateRequest {
  topic: string
  goal: string
  targetDescription: string
  onBehalfOf: { name: string; title: string; mandate: string } | null
  /**
   * When present, the plan is assembled from the business's own approved,
   * rated knowledge instead of invented from the three free-text fields above.
   *
   * Optional because the /rules page is also a drafting tool with no assignment
   * behind it, and that is a real mode rather than a degraded one.
   */
  assignmentId?: string
}

/** Fill the rules page from a description instead of typing every argument by hand. */
export async function POST(req: Request) {
  try {
    assertModelAccessConfigured()
    const input = (await req.json()) as GenerateRequest

    // Same gate as /api/chat, and for the same reason: preparing a plan for an
    // assignment reads that business's knowledge, so it is not something an
    // unauthenticated caller may ask for.
    const access = await resolveAccess(req.headers.get('authorization') ?? '', input.assignmentId)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    if (!input.topic?.trim() || !input.goal?.trim() || !input.targetDescription?.trim()) {
      return NextResponse.json({ error: 'צריך נושא, מטרה ותיאור של מי שמולנו.' }, { status: 400 })
    }

    // Absent storage is not an error here: without it there is nothing to
    // retrieve and the drafting path is exactly what the caller gets.
    // The tenant comes from the resolved access, which took it from the
    // caller's own profile -- never from the environment and never from the
    // body.
    const ammunition =
      input.assignmentId && isStorageConfigured()
        ? await loadAmmunition(supabase(), input.assignmentId, access.context.tenantId)
        : null

    if (input.assignmentId && isStorageConfigured() && !ammunition) {
      return NextResponse.json({ error: 'המשימה לא נמצאה.' }, { status: 404 })
    }

    const plan = await preparePlan({ ...input, id: input.assignmentId ?? 'custom', ammunition })
    return NextResponse.json({ plan, grounded: Boolean(ammunition) })
  } catch (error) {
    // A cross-tenant assignment id is a 403, not a 500: it is a refusal, and
    // reporting it as a server fault would invite a retry.
    if (error instanceof CrossTenantError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    const message = error instanceof Error ? error.message : 'שגיאה לא ידועה'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
