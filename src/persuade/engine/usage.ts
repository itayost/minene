import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * Tokens spent by one run, by role.
 *
 * Carried in AsyncLocalStorage rather than threaded through every signature,
 * for two reasons. The worker runs several simulations concurrently in one
 * process, so a module-level counter would mix them. And persuaderTurn,
 * targetReply and scoreRun are guarded by source-text tests
 * (world-isolation, tenant-boundary) that pin their call sites: adding a meter
 * parameter would mean loosening a security assertion to count tokens.
 *
 * Outside a scope, recording is a no-op, so the chat route pays nothing.
 */

export type UsageRole = 'persuader' | 'target' | 'judge'

export interface TokenCount {
  input: number
  output: number
}

export type UsageTotals = Record<UsageRole, TokenCount>

/** The subset of the AI SDK's LanguageModelUsage this reads. Counts can be absent. */
export interface ReportedUsage {
  inputTokens?: number | undefined
  outputTokens?: number | undefined
}

export interface UsageMeter {
  record(role: UsageRole, usage: ReportedUsage | undefined): void
  totals(): UsageTotals
}

const zero = (): TokenCount => ({ input: 0, output: 0 })

export function createUsageMeter(): UsageMeter {
  let totals: UsageTotals = { persuader: zero(), target: zero(), judge: zero() }

  return {
    record(role, usage) {
      const current = totals[role]
      totals = {
        ...totals,
        [role]: {
          input: current.input + (usage?.inputTokens ?? 0),
          output: current.output + (usage?.outputTokens ?? 0),
        },
      }
    },
    totals: () => totals,
  }
}

const scope = new AsyncLocalStorage<UsageMeter>()

export function withUsageMeter<T>(meter: UsageMeter, work: () => Promise<T>): Promise<T> {
  return scope.run(meter, work)
}

export function recordUsage(role: UsageRole, usage: ReportedUsage | undefined): void {
  scope.getStore()?.record(role, usage)
}
