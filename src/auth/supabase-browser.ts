'use client'

import { createBrowserClient } from '@supabase/ssr'
import { requireSupabaseConfig } from './supabase-config'

export function createBrowserSupabase() {
  const { url, key } = requireSupabaseConfig()
  return createBrowserClient(url, key)
}
