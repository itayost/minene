import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { requireSupabaseConfig } from './supabase-config'

/**
 * Reads the request's cookies. Writing them from a server component is not
 * permitted by Next, so `setAll` is a no-op here: the middleware owns cookie
 * refresh, and swallowing the write is the documented pattern rather than an
 * oversight.
 */
export async function createServerSupabase() {
  const { url, key } = requireSupabaseConfig()
  const cookieStore = await cookies()

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => undefined,
    },
  })
}
