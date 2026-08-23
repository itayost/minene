'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { createBrowserSupabase } from '../../src/auth/supabase-browser'

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    try {
      const { error: signInError } = await createBrowserSupabase()
        .auth.signInWithPassword({ email, password })

      if (signInError) {
        // Deliberately not echoing the provider's message: it distinguishes an
        // unknown address from a wrong password, which tells an attacker which
        // addresses have accounts.
        setError('הפרטים אינם נכונים')
        return
      }

      // The server re-validates `next` against the caller's own brand before
      // honouring it, so a link from another tenant cannot survive this.
      router.replace(next ?? '/')
      router.refresh()
    } catch {
      setError('לא הצלחנו להתחבר. נסי שוב.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form className="login-form" onSubmit={submit}>
      <label className="login-field">
        <span>אימייל</span>
        <input
          autoComplete="email"
          dir="ltr"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>

      <label className="login-field">
        <span>סיסמה</span>
        <input
          autoComplete="current-password"
          dir="ltr"
          name="password"
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>

      {error ? <p className="login-error" role="alert">{error}</p> : null}

      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? 'מתחברת...' : 'כניסה'}
      </button>
    </form>
  )
}
