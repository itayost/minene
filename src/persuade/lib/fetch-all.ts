/**
 * Fetches every row a query matches, not just the first page of it.
 *
 * PostgREST -- which is what a Supabase `.select()` talks to -- caps an
 * un-ranged request at a server-configured row limit (1000 by default), and an
 * explicit `.limit(n)` caps it at exactly `n` regardless of how many rows
 * actually match. Either way, a table that has grown past the cap gets read as
 * though it had not: the query returns cleanly, with no error, holding a
 * silently truncated slice. A report built on that slice states its numbers
 * with full confidence and shrinks the fraction of history it is actually
 * measuring a little more every day, without ever saying so.
 *
 * `page` is a factory rather than a query, because a Postgrest query builder is
 * spent once it is awaited -- each page needs a fresh one with `.range()`
 * applied to it.
 */
export async function fetchAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await page(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < pageSize) return rows
  }
}
