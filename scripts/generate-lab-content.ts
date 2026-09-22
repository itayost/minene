/**
 * Writes the lab's generated personas and plans from role_needs.
 *
 *   pnpm lab:generate [--industry retail] [--force]
 *
 * Calls the planner model about 112 times for all three industries and writes
 * to the linked project, so run it deliberately. Existing keys are skipped
 * unless --force. Exits non-zero when anything was rejected, with the reasons.
 */
import { parseArgs } from 'node:util'
import { createClient } from '@supabase/supabase-js'
import { generateLabContent } from '../src/persuade/lib/generate-lab-content'
import { assertModelAccessConfigured } from '../src/persuade/lib/model'
import { env } from './lib/db'

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      industry: { type: 'string' },
      force: { type: 'boolean' },
    },
    strict: true,
  })

  const { url, key } = env()
  assertModelAccessConfigured()

  const db = createClient(url, key, { auth: { persistSession: false } })
  const report = await generateLabContent(db, {
    industry: values.industry,
    force: values.force ?? false,
  })

  console.log(
    `נכתבו ${report.written.length}, דולגו ${report.skipped.length}, נדחו ${report.rejected.length}.`,
  )
  // Printed every run: generation is the most expensive thing this project
  // does, and it used to leave no trace of what it spent.
  console.log(
    `טוקנים: ${report.usage.input.toLocaleString('en-US')} קלט, ${report.usage.output.toLocaleString('en-US')} פלט.`,
  )
  for (const rejection of report.rejected) {
    console.error(`  - ${rejection.key}: ${rejection.problems.join(' · ')}`)
  }
  if (report.rejected.length > 0) process.exitCode = 1
}

await main()
