import type { StoredSimulation } from './lib/simulations'
import { createSimulationsStore } from './lib/simulations'

/**
 * The browser's view of the simulations table.
 *
 * It reuses the server store rather than restating its column list and row
 * mapping: the two would drift, and the column most likely to be forgotten is
 * `score`, which is the one the bank cannot work without.
 *
 * Reading is safe from here. simulations_select_authenticated admits every
 * signed-in member of any tenant by design -- there is nothing private in an
 * invented conversation, and cross-tenant reads are the whole point of a matrix
 * that compares one sector to another. Writing is owner-only and happens on the
 * server, where the run is scored first.
 */
export function createSimulationsApi(client: Parameters<typeof createSimulationsStore>[0]) {
  const store = createSimulationsStore(client)
  return {
    listSimulationSummaries: (): Promise<StoredSimulation[]> => store.listSimulationSummaries(),
    countSimulations: (): Promise<number> => store.countSimulations(),
    countSimulationsSince: (iso: string): Promise<number> => store.countSimulationsSince(iso),
    countAttemptsSince: (iso: string): Promise<number> => store.countAttemptsSince(iso),
  }
}

export type SimulationsApi = ReturnType<typeof createSimulationsApi>
