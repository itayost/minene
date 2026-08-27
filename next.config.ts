import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * Development only.
   *
   * Next treats 127.0.0.1 as a cross-origin dev host and blocks its own dev
   * resources from it -- including the client chunks -- so the page renders on
   * the server, never hydrates, and every screen looks like a static mockup
   * with dead buttons and empty selects. Chrome resolves `localhost` to ::1 and
   * the dev server listens on IPv4, so browsing by name is not the way out.
   *
   * Nothing here reaches production: allowedDevOrigins governs `next dev` only.
   */
  allowedDevOrigins: ['127.0.0.1'],

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
