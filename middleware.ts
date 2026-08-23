import { NextResponse, type NextRequest } from 'next/server'
import { LOGIN_PATH } from './src/auth/paths'
import { isSupabaseConfigured } from './src/auth/supabase-config'
import { createMiddlewareSupabase } from './src/auth/supabase-middleware'

export async function middleware(request: NextRequest) {
  // With no project configured there is no session to refresh and no way to
  // sign in, so gating here would lock a developer out of an app that cannot
  // authenticate anyone anyway. requireBrand still refuses to serve content.
  if (!isSupabaseConfigured()) return NextResponse.next()

  const { supabase, response } = createMiddlewareSupabase(request)

  // getUser(), not getSession(): this call is also what refreshes an expiring
  // token, and it validates against the auth server rather than trusting the
  // cookie it was handed.
  const { data } = await supabase.auth.getUser()

  if (!data.user) {
    const loginUrl = new URL(LOGIN_PATH, request.url)
    loginUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(loginUrl)
  }

  return response()
}

export const config = {
  /**
   * Skips, in order: the login screen itself (or a signed-out visitor redirects
   * forever), the sign-out route (which must work even with a dead session),
   * Next's build output and favicon, and /brands/* -- the page images stay
   * public until sub-project 2b moves them into storage, and gating them here
   * would break every page in the viewer the moment auth lands.
   */
  matcher: ['/((?!login|logout|_next/static|_next/image|favicon.ico|brands/).*)'],
}
