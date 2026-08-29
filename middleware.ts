import { type NextRequest, NextResponse } from 'next/server'
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
   * every API route, Next's build output and favicon, and /brands/* -- the page
   * images stay public until sub-project 2b moves them into storage, and gating
   * them here would break every page in the viewer the moment auth lands.
   *
   * `api` is skipped because a redirect is not an answer a fetch can use: this
   * matcher would turn an unauthenticated call into a 307 pointing at an HTML
   * login page. Those routes verify their own caller before touching a model,
   * and they answer 401, which a caller can act on.
   */
  matcher: ['/((?!login|logout|api/|_next/static|_next/image|favicon.ico|brands/).*)'],
}
