/**
 * Writes the lab's generated personas and plans from role_needs.
 *
 *   pnpm lab:generate [--industry=retail] [--force]
 *
 * Calls the planner model about 112 times for all three industries and writes
 * to the linked project, so run it deliberately. Existing keys are skipped
 * unless --force. Exits non-zero when anything was rejected, with the reasons.
 */
import { createClient } from '@supabase/supabase-js'
import { env } from './lib/db'

const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1]

async function main(): Promise<void> {
  // Credentials first, then the modules that read model settings from the
  // environment: model.ts resolves model ids when it is imported, so a static
  // import would miss anything env() just loaded from .env.local.
  const { url, key } = env()
  const { assertModelAccessConfigured } = await import('../src/persuade/lib/model')
  const { generateLabContent } = await import('../src/persuade/lib/generate-lab-content')
  assertModelAccessConfigured()

  const db = createClient(url, key, { auth: { persistSession: false } })
  const report = await generateLabContent(db, {
    industry: arg('industry'),
    force: process.argv.includes('--force'),
  })

  console.log(
    `נכתבו ${report.written.length}, דולגו ${report.skipped.length}, נדחו ${report.rejected.length}.`,
  )
  for (const rejection of report.rejected) {
    console.error(`  - ${rejection.key}: ${rejection.problems.join(' · ')}`)
  }
  if (report.rejected.length > 0) process.exitCode = 1
}

await main()
