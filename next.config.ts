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
   * `outputFileTracingIncludes` for `content/**` used to live here.
   *
   * The engine read its personas and plans with
   * `readdir(path.join(process.cwd(), 'content', kind))` -- a path built from a
   * string, which Next's tracing cannot follow, so the directory had to be
   * named explicitly or every simulation threw ENOENT in production while
   * working on a laptop.
   *
   * They are rows now (public.persuasion_personas, public.persuasion_lab_plans),
   * nothing reads that directory at runtime, and config for a file nobody opens
   * is worse than no config: it says the deployment depends on something it
   * does not.
   */
}

export default nextConfig
