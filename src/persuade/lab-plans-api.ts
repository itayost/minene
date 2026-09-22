import type { PersuasionPlan } from './engine/types'

/**
 * One library plan, fetched when a need is opened.
 *
 * By key rather than all at once: there are 131 plans, each a full jsonb plan
 * with arguments, objections and an escalation ladder, and the screen shows one
 * at a time. persuasion_lab_plans grants select to authenticated and holds no
 * tenant's knowledge by construction -- its own table comment says why.
 */
interface PlansClient {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        maybeSingle(): PromiseLike<{
          data: Record<string, unknown> | null
          error: { message: string } | null
        }>
      }
    }
  }
}

export function createLabPlansApi(client: PlansClient) {
  return {
    /**
     * Null when the need has no generated plan yet, which is a real state and
     * not an error: the taxonomy has 130 needs and generation is a separate
     * pass over it.
     */
    async getPlan(planKey: string): Promise<PersuasionPlan | null> {
      const { data, error } = await client
        .from('persuasion_lab_plans')
        .select('plan_key,plan')
        .eq('plan_key', planKey)
        .maybeSingle()

      if (error) throw new Error(`קריאת התוכנית נכשלה: ${error.message}`)
      // `!data.plan` as well as `!data`: a row whose jsonb is null spreads to
      // `{}`, and a plan with no `arguments` array takes the whole screen down
      // on the first `.map`. A row with nothing in it is the same answer to
      // the reader as no row at all.
      if (!data?.plan) return null

      // plan_key is asserted over the stored plan's own id, exactly as
      // loadPlans does: the key is the handle a run is recorded under.
      return { ...(data.plan as PersuasionPlan), id: String(data.plan_key) }
    },
  }
}

export type LabPlansApi = ReturnType<typeof createLabPlansApi>
