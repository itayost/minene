/**
 * The two things every report script needs: credentials, and a read of the
 * whole table.
 *
 * Shared rather than copied because the copies drifted: the paging fix that
 * replaced `.limit(5000)` in one report left the other two reading whatever
 * PostgREST felt like returning, which is the same silent truncation with a
 * different script name on it.
 */
import { readFileSync } from 'node:fs'

export function env(): { url: string; key: string } {
  try {
    const file = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    for (const line of file.split('\n')) {
      const at = line.indexOf('=')
      if (at > 0 && !line.trimStart().startsWith('#')) {
        const name = line.slice(0, at).trim()
        if (!process.env[name]) process.env[name] = line.slice(at + 1).trim()
      }
    }
  } catch {
    // Already in the environment is fine.
  }
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('חסרים SUPABASE_URL ו-SUPABASE_SECRET_KEY.')
  return { url, key }
}

/**
 * Reads every row rather than the first slice.
 *
 * `.limit(n)` is a silent ceiling: past it the report describes a subset while
 * looking exactly like a report on everything. PostgREST applies its own
 * max-rows on top, so even a large limit is not a guarantee.
 *
 * The window advances by the number of rows that actually came back, not by
 * the number that were asked for. A server capped below `size` answers every
 * request short, and a loop that reads a short page as "that was the last one"
 * stops on the first one -- which is the truncation this function exists to
 * prevent, reintroduced by the thing meant to prevent it. Costs one empty
 * request at the end; that is the price of not guessing the server's cap.
 */
export async function readAll<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; ) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(`קריאת השורות נכשלה: ${error.message}`)
    const batch = data ?? []
    if (batch.length === 0) return rows
    rows.push(...batch)
    from += batch.length
  }
}
