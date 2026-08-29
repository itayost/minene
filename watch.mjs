import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
})
const { data } = await db
  .from('simulation_jobs')
  .select('status,attempts,error')
  .order('created_at')
const counts = {}
for (const j of data ?? []) counts[j.status] = (counts[j.status] ?? 0) + 1
console.log('jobs:', JSON.stringify(counts))
for (const j of (data ?? []).filter((j) => j.error)) console.log('  error:', j.error)
const sims = await db.from('simulations').select('id', { count: 'exact', head: true })
console.log('simulations total:', sims.count)
const withWorld = await db
  .from('simulations')
  .select('id', { count: 'exact', head: true })
  .not('world', 'is', null)
console.log('with a world:', withWorld.count)
