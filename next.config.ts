import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  /**
   * The persuasion engine reads its personas and plans from disk at request
   * time -- `readdir(path.join(process.cwd(), 'content', kind))` -- which is a
   * fully dynamic path. Next's output file tracing follows imports, and it
   * cannot see a directory named by a string, so `content/` would be left out
   * of the deployed function and every simulation would throw ENOENT in
   * production while working perfectly on a laptop.
   */
  outputFileTracingIncludes: {
    '/api/persuade/**': ['./content/**/*'],
  },
}

export default nextConfig
