# Multi-Brand Content Viewer

A static React and TypeScript viewer for Minene Cockpit content and additional manifest-driven brands. The shared interface handles navigation, page viewing, saved progress, sharing, downloads, and responsive mobile framing; each brand supplies only configuration and public assets.

## Requirements

- Node.js 20.19 or newer
- pnpm (the repository pins pnpm 10.34.5 so the complete toolchain supports Node.js 20.19)

## Local development

Install dependencies and start Next.js:

```bash
pnpm install
pnpm dev
```

This starts Next on port 3000.

Run the complete test, type-check, manifest-validation, and production-build gate:

```bash
pnpm check
```

You can also build separately:

```bash
pnpm build
```

To inspect that exact production output locally, run the equivalent of `pnpm preview`:

```bash
pnpm build && pnpm start
```

## URL behavior

Every screen has its own address, in one of four shapes:

- `/<brand-id>` — the brand home screen.
- `/<brand-id>/<subject-id>` — a subject's group chooser. A subject with exactly one group redirects straight to that group's viewer instead.
- `/<brand-id>/<subject-id>/<group-id>` — the page viewer for a group, optionally with a one-based `?page=` query parameter naming the page to open.
- `/<brand-id>/tools/<tool-id>` — a brand tool screen.

`/` loads Minene as the default brand. An unknown subject, group, or tool returns a 404. An unknown brand ID also returns a 404, rendered as the brand-not-found screen rather than the generic not-found page.

## Deploying with Vercel

`vercel.json` pins `"framework": "nextjs"`. Settings in `vercel.json` override the
Vercel project settings, so this is what stops a stale Framework Preset of `vite`
(left from the pre-conversion build) from making a deploy serve a `dist`
directory that no longer exists. Do not remove it without checking the project's
preset first.

No environment variables or backend services are required for this release.

**Check this before the first deploy.** This repository previously shipped a Vite build, and the Vercel project it was linked to (`.vercel/project.json`) may still carry that build's settings. In the project's **Settings, Build and Deployment**, confirm both of the following:

- **Framework Preset** is **Next.js**, not Vite.
- **Output Directory** has **no override**. A leftover `dist` override makes Vercel build Next and then serve an empty directory, so the first deploy after this merge returns nothing at every address.

Vercel autodetects Next.js on a new project, so a project imported fresh needs neither change. Only a project carrying settings from the Vite build does, and it will not announce them.

1. Import this repository as a project in Vercel, or open the existing linked project.
2. Keep the repository root as the project root, and confirm the two settings above.
3. Deploy, then verify `/`, `/minene`, a deep group URL, and a tool URL with a direct full-page load.

## Authentication

Every screen is behind a Supabase session. A signed-in user's profile resolves a
tenant, and the tenant resolves the one brand they may see, so the brand in the
URL is a claim the server verifies rather than a free choice.

Copy `.env.example` to `.env.local` and fill in both values:

```bash
cp .env.example .env.local
```

Both are public browser configuration. A service-role key must never appear in
this repository.

Accounts are created by an owner in the Supabase dashboard under
Authentication > Users. Public signup is disabled deliberately: there is no
self-service path into a tenant.

Signing out is `GET /logout`. There is deliberately no control for it in the
interface. Any sign-out button in the shell header would change all four visual
references at all five widths, and those cannot be regenerated. The control
arrives when the tool screens are rebuilt and the shell changes for real reasons.

Requesting a brand that belongs to another tenant answers 404, never 403, so
probing cannot be used to enumerate which tenants exist.

Note that the page images under `public/brands/` are still served publicly. The
interface is private; the content is unlisted rather than secret. Moving those
behind per-tenant storage is a separate piece of work.

## Visual references

The suite signs in before it compares, because every route now requires a
session. Set `VIEWER_TEST_EMAIL` and `VIEWER_TEST_PASSWORD` to a real account in
the tenant that owns the `minene` brand:

```bash
VIEWER_TEST_EMAIL=... VIEWER_TEST_PASSWORD=... pnpm visual:verify
```

Without those two variables the suite skips every test with a reason rather than
failing against screenshots of the login screen. `pnpm check` never needs them:
a fresh clone still runs the unit tests and a production build with nothing
configured.


`tests/visual/__snapshots__` holds 20 screenshots: four screens at five widths. They were captured from the Vite build that preceded the Next.js conversion, and that application no longer exists, so they cannot be regenerated. They are the only surviving evidence that the conversion left the design unchanged, which is why both `pnpm visual:reference` and the Playwright config refuse to overwrite them. An accidental overwrite is recovered with `git restore tests/visual/__snapshots__`, not by recapturing.

Compare the current build against them:

```bash
pnpm visual:verify
```

That builds the app, starts it on port 4173, runs the comparison, and shuts the server down again. Nothing needs to be running first, and a server left running from earlier is deliberately not reused, because comparing against a stale build would pass while proving nothing.

The references were captured on macOS. `snapshotPathTemplate` stores one set for all platforms, so running the comparison on Linux or Windows fails all 20 on font rasterisation alone, with a diff that looks like a design change and is not. Treat a failure on another platform as unverified rather than as a regression, and check it on macOS.

To compare an already-deployed build instead of a local one, set `VIEWER_BASE_URL`; the suite then starts no server of its own.

For the complete brand manifest and asset workflow, see [Adding a brand](docs/adding-a-brand.md).
