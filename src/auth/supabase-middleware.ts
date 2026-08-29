import { createServerClient } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import { requireSupabaseConfig } from './supabase-config'

/**
 * The only place a refreshed auth cookie can actually be written. Both the
 * request and the response carry the new cookies: the request copy so anything
 * later in this same pass sees the refreshed session, the response copy so the
 * browser keeps it.
 *
 * `response` is a getter, not a value. Supabase replaces the response object
 * whenever it writes refreshed cookies, so a caller that captures it up front
 * would send the stale one and silently drop the refreshed session.
 */
export function createMiddlewareSupabase(request: NextRequest) {
  const { url, key } = requireSupabaseConfig()
  let response = NextResponse.next({ request })

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  return { supabase, response: () => response }
}
