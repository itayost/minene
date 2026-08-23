import { NextResponse, type NextRequest } from 'next/server'
import { LOGIN_PATH } from '../../src/auth/paths'
import { isSupabaseConfigured } from '../../src/auth/supabase-config'
import { createMiddlewareSupabase } from '../../src/auth/supabase-middleware'

/**
 * A route handler rather than a page, because signing out has to clear cookies
 * on the response, which a server component cannot do.
 *
 * There is no link to this anywhere in the shell. A sign-out control in the
 * header would change all four reference screens at all five widths, and those
 * references cannot be regenerated. Sub-project 3 replaces the tool screens and
 * the shell changes for real reasons; the control arrives then.
 */
async function signOut(request: NextRequest) {
  const redirectTo = new URL(LOGIN_PATH, request.url)
  if (!isSupabaseConfigured()) return NextResponse.redirect(redirectTo)

  const { supabase, response } = createMiddlewareSupabase(request)
  await supabase.auth.signOut()

  const cleared = NextResponse.redirect(redirectTo)
  for (const cookie of response().cookies.getAll()) {
    cleared.cookies.set(cookie)
  }
  return cleared
}

export async function GET(request: NextRequest) {
  return signOut(request)
}

export async function POST(request: NextRequest) {
  return signOut(request)
}
