import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * The persuasion engine reads its personas and plans from disk at request
   * time -- `readdir(path.join(process.cwd(), 'content', kind))` -- which is a
   * fully dynamic path. Next's output file tracing follows imports, and it
   * cannot see a directory named by a string, so `content/` would be left out
   * of the deployed function and every simulation would throw ENOENT in
   * production while working perfectly on a laptop.
   *
   * The lab page reads the same directory to fill its persona and plan pickers,
   * and it is a separate function from the routes -- so it needs its own entry
   * here. Without it the screen renders empty selects in production and there
   * is nothing to run.
   */
  outputFileTracingIncludes: {
    '/api/persuade/**': ['./content/**/*'],
    '/[brandId]/tools/persuade/lab': ['./content/**/*'],
  },
}

export default nextConfig
