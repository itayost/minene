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
  // cookies() first, deliberately. Awaiting it is what marks the calling route
  // dynamic, and that has to happen before anything that can throw: if the
  // config check runs first and fails, Next never sees the cookie access, treats
  // the route as static, tries to prerender it at build time, and the build dies
  // on a missing environment variable instead of the route simply being dynamic.
  const cookieStore = await cookies()
  const { url, key } = requireSupabaseConfig()

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => undefined,
    },
  })
}
