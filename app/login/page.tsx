import { redirect } from 'next/navigation'
import { nextWithinBrand, safeNextPath } from '../../src/auth/safe-next'
import { asSessionClient, loadSessionBrand } from '../../src/auth/session'
import { isSupabaseConfigured } from '../../src/auth/supabase-config'
import { createServerSupabase } from '../../src/auth/supabase-server'
import { DEFAULT_BRAND_ID, getBrand } from '../../src/core/brand-registry'
import { brandHref } from '../../src/core/hrefs'
import { LoginForm } from './login-form'

type LoginParams = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export const metadata = { title: 'כניסה' }

export default async function LoginPage({ searchParams }: LoginParams) {
  const query = await searchParams
  const rawNext = typeof query.next === 'string' ? query.next : null

  if (isSupabaseConfigured()) {
    const session = await loadSessionBrand(asSessionClient(await createServerSupabase()))
    // An authenticated visitor has no business sitting on a sign-in form. The
    // middleware cannot do this: it deliberately does not run on /login.
    if (session) {
      redirect(nextWithinBrand(rawNext, session.brandId) ?? brandHref(session.brandId))
    }
  }

  // The brand comes from the session, and there is none yet, so the screen wears
  // the default brand. With one tenant this is invisible; with several it means
  // everyone signs in wearing Minene's colours. Accepted, not solved.
  const brand = getBrand(DEFAULT_BRAND_ID)

  return (
    <main className="login-screen" dir="rtl" lang="he">
      <div className="login-card">
        {brand ? <img className="login-logo" src={brand.logo.src} alt="" /> : null}
        <h1>כניסה</h1>
        <LoginForm next={safeNextPath(rawNext)} />
      </div>
    </main>
  )
}
