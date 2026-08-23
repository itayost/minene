/**
 * Read on use, never at module load. A fresh clone and CI have no credentials,
 * and every test file that transitively imports a client factory would fail at
 * import time if this threw on load -- which makes the suite pass locally and
 * fail everywhere else. eran-task documents the same trap in
 * src/services/supabaseClient.js.
 */
export function supabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) return null
  return { url, key }
}

export function isSupabaseConfigured(): boolean {
  return supabaseConfig() !== null
}

export function requireSupabaseConfig(): { url: string; key: string } {
  const config = supabaseConfig()
  if (!config) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. '
      + 'Copy .env.example to .env.local and fill both in.',
    )
  }
  return config
}
