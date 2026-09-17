/**
 * Runs `work` over `items`, at most `concurrency` at a time.
 *
 * Not Promise.all over the batch: eight simulations at once is eight
 * simultaneous persuader calls, and the provider's rate limit is the thing that
 * actually decides how many can run. The number is an env var so it can be
 * turned down without a deploy.
 *
 * `work` is expected to settle its own failures. A rejection here rejects the
 * whole pool, which in the worker would leave the rest of the batch `running`
 * until the stale-claim window re-offers it.
 */
export async function runPool<T, R>(
  items: readonly T[],
  concurrency: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0

  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index] as T)
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: lanes }, lane))
  return results
}
